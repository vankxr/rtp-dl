const Path = require("path");
const FileSystem = require("fs");
const ChildProcess = require("child_process");
const HTTPS = require("https");
const URL = require("url");
const { Command } = require("commander");
const HTML = require("node-html-parser");
const Colors = require("colors");
const M3U8Parser = require("../lib/m3u8parser.js");

const program = new Command();
const package = JSON.parse(FileSystem.readFileSync(Path.join(__dirname, "../package.json")));

program.version(package.version, "-v, --version", "Print the current version");
program.helpOption('-h, --help', 'Display this help information');
program.showHelpAfterError();
program.showSuggestionAfterError();
program.configureOutput(
    {
        writeOut: (str) => process.stderr.write(`${str}`),
        writeErr: (str) => process.stderr.write(`${str}`)
    }
);

function parseRTPUrl(url)
{
    let pid_match = url.match(/play\/p(\d+)(\/e(\d+))?/);

    if(pid_match)
        return {
            url: url,
            pid: parseInt(pid_match[1]),
            eid: parseInt(pid_match[3])
        };

    let live_match = url.match(/direto\/([a-zA-Z0-9]+)/);

    if(live_match)
        return {
            url: url,
            channel: live_match[1]
        };

    return {
        url: url
    };
}
function url_rewrite(url, endpoint)
{
    let components = url.split("/");

    components[components.length - 1] = endpoint;

    return components.join("/");
}
function atob(str)
{
    return Buffer.from(str, "base64").toString("utf-8");
}
async function sleep(ms)
{
    return new Promise(resolve => setTimeout(resolve, ms));
}
////////////////////////////////////////////////
async function https_request(options, body)
{
    return new Promise(
        function (resolve, reject)
        {
            const req = HTTPS.request(
                options,
                function (res)
                {
                    res.body = [];

                    res.on('data',
                        function (chunk)
                        {
                            res.body.push(chunk);
                        }
                    );

                    res.on('end',
                        function()
                        {
                            res.body = Buffer.concat(res.body);

                            return resolve(res);
                        }
                    );
                }
            )

            req.on("error", reject);

            if(body)
                req.write(body);

            req.end();
        }
    );
}
function m3u8_request(url)
{
    let url_data = URL.parse(url);
    let req_options = {
        host: url_data.host,
        port: 443,
        path: url_data.path,
        method: "GET",
        headers: {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36",
            "Cookie": "rtp_cookie_parental=0; rtp_privacy=666; rtp_cookie_privacy=permit 1,2,3,4; googlepersonalization=1; _recid="
        }
    };

    const parser = new M3U8Parser();
    const req = HTTPS.request(
        req_options,
        function (res)
        {
            res.pipe(parser);
        }
    )

    req.end();

    return parser;
}

async function rtp_get_program_name(pid)
{
    let req_options = {
        host: "www.rtp.pt",
        port: 443,
        path: "/play/bg_l_ep/?listProgram=" + pid,
        method: "GET",
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Cookie": "rtp_cookie_parental=0; rtp_privacy=666; rtp_cookie_privacy=permit 1,2,3,4; googlepersonalization=1; _recid="
        }
    };

    let res = await https_request(req_options);

    if(res.statusCode != 200)
    {
        let e = new Error("Request unsuccessfull (" + res.statusCode + ")");

        e.details = res.body;

        throw e;
    }

    if(!res.body)
        throw new Error("Invalid body");

    let root = HTML.parse(res.body.toString("utf-8"));

    let as = root.getElementsByTagName("a");
    let first_a = as[0];

    if(!first_a)
        throw new Error("Program not found");

    let program_name = first_a.getAttribute("title");

    if(!program_name)
        throw new Error("Program not found");

    return program_name.split(" - ")[0];
}
async function rtp_get_program_seasons(pid)
{
    let eps = await rtp_get_program_episodes(pid);

    if(eps.length < 1)
        throw new Error("No episodes found");

    let url = eps[0].url;

    if(!url)
        throw new Error("Invalid episode URL");

    let req_options = {
        host: "www.rtp.pt",
        port: 443,
        path: url,
        method: "GET",
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Cookie": "rtp_cookie_parental=0; rtp_privacy=666; rtp_cookie_privacy=permit 1,2,3,4; googlepersonalization=1; _recid="
        }
    };

    let res = await https_request(req_options);

    if(res.statusCode != 200)
    {
        let e = new Error("Request unsuccessfull (" + res.statusCode + ")");

        e.details = res.body;

        throw e;
    }

    if(!res.body)
        throw new Error("Invalid body");

    let root = HTML.parse(res.body.toString("utf-8"));

    let season_div = root.getElementsByTagName("div").find(
        function (div)
        {
            if(!div.getAttribute("class"))
                return false;

            if(div.getAttribute("class").indexOf("seasons-available") == -1)
                return false;

            return true;
        }
    );

    if(!season_div)
        throw new Error("Season div not found");

    let seasons = season_div.getElementsByTagName("a");

    if(!seasons)
        throw new Error("No seasons found");

    seasons = seasons.map(
        function (season)
        {
            return {
                number: parseInt(season.text.trim()),
                pid: parseRTPUrl(season.getAttribute("href")).pid,
                url: season.getAttribute("href")
            };
        }
    );

    seasons = seasons.filter(season => (!isNaN(season.number) && season.number > 0));

    return seasons;
}
async function rtp_get_program_episodes(pid)
{
    let page = 1;
    let episodes = [];

    while(true)
    {
        let req_options = {
            host: "www.rtp.pt",
            port: 443,
            path: "/play/bg_l_ep/?listProgram=" + pid + "&page=" + page,
            method: "GET",
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Cookie": "rtp_cookie_parental=0; rtp_privacy=666; rtp_cookie_privacy=permit 1,2,3,4; googlepersonalization=1; _recid="
            }
        };

        let res = await https_request(req_options);

        if(res.statusCode != 200)
        {
            let e = new Error("Request unsuccessfull (" + res.statusCode + ")");

            e.details = res.body;

            throw e;
        }

        if(!res.body)
            throw new Error("Invalid body");

        let root = HTML.parse(res.body.toString("utf-8"));
        let articles = root.getElementsByTagName("article");

        if(articles.length == 0)
            break;

        for(let article of articles)
        {
            let episode = {};

            let a = article.childNodes[1];

            if(!a || a.tagName.toLowerCase() != "a")
                continue;

            episode.url = a.getAttribute("href");
            episode.title = a.getAttribute("title");

            for(let div of a.childNodes)
            {
                if(!div.tagName || div.tagName.toLowerCase() != "div")
                    continue;

                switch (div.getAttribute("class"))
                {
                    case "img-holder video-holder":
                    {
                        let scripts = div.getElementsByTagName("script");
                        let first_script = scripts[0];

                        if(!first_script)
                            break;

                        let script_text = first_script.text;
                        let script_match = [...script_text.matchAll(/\'([^\']+)\'/g)];

                        if(!script_match)
                            break;

                        episode.thumbnail = script_match[0][1];
                        episode.preview = "https:" + script_match[1][1];
                        episode.full_title = script_match[3][1];
                    }
                    break;
                    case "article-meta-data":
                    {
                        for(let span of div.childNodes)
                        {
                            if(!span.tagName || span.tagName.toLowerCase() != "span")
                                continue;

                            switch(span.getAttribute("class"))
                            {
                                case "episode":
                                    episode.id = span.text;
                                break;
                                case "episode-date":
                                    episode.date = span.text;
                                break;
                                case "episode-title":
                                    episode.title = span.text;
                                break;
                            }
                        }
                    }
                    break;
                }
            }

            let i = article.childNodes[3];

            if(i && i.tagName.toLowerCase() == "i")
            {
                for(let meta of i.childNodes)
                {
                    if(!meta.tagName || meta.tagName.toLowerCase() != "meta")
                        continue;

                    switch (meta.getAttribute("itemprop"))
                    {
                        case "description":
                            episode.description = meta.getAttribute("content");
                        break;
                    }
                }
            }

            if(episode.title.indexOf(" - ") != -1)
            {
                episode.full_title = episode.title;
                episode.title = episode.full_title.split(" - ")[1];
            }

            episodes.push(episode);
        }

        page++;
    }

    return episodes;
}
async function rtp_get_stream_url(url)
{
    let req_options = {
        host: "www.rtp.pt",
        port: 443,
        path: url,
        method: "GET",
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Cookie": "rtp_cookie_parental=0; rtp_privacy=666; rtp_cookie_privacy=permit 1,2,3,4; googlepersonalization=1; _recid="
        }
    };

    let res = await https_request(req_options);

    if(res.statusCode != 200)
    {
        let e = new Error("Request unsuccessfull (" + res.statusCode + ")");

        e.details = res.body;

        throw e;
    }

    if(!res.body)
        throw new Error("Invalid body");

    let on_demand = res.body.toString("utf-8").indexOf("area=\"on-demand\";") != -1;
    let live = res.body.toString("utf-8").indexOf("area=\"em-direto\";") != -1;

    if(!live && !on_demand)
        throw new Error("Invalid stream type");

    if(live && on_demand)
        throw new Error("Invalid stream type");

    let root = HTML.parse(res.body.toString("utf-8"));

    for(let script of root.getElementsByTagName("script"))
    {
        if(script.text.indexOf("RTPPlayer") == -1)
            continue;

        // For audio only programs
        //// URL regex stolen from https://stackoverflow.com/a/3809435 :)
        //// Editted to include the 'var f = "...";´
        let f_match = script.text.match(/var\sf\s=\s\"(https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*))\"\;/);

        if(f_match)
            return f_match[1];

        // Now handle video programs
        f_match = [...script.text.matchAll(/hls\s?:\s(atob\(\s)?decodeURIComponent\(\[(\"([^\"]+)\"(\,)?)+\].join\(\"\"\)\)/g)];

        if(!f_match)
            throw new Error("No stream found");

        f_match = f_match.map(m => m[0]);

        let f_str = f_match[f_match.length - 1];

        let c_match = [...f_str.matchAll(/\"([^\"]+)\"(\,)?/g)];

        if(!c_match)
            throw new Error("No stream found");

        c_match = c_match.map(m => m[1])

        let url;

        if(on_demand)
            url = decodeURIComponent(atob(c_match.join("")));
        if(live)
            url = decodeURIComponent(c_match.join(""));

        return url;
    }
}
async function rtp_get_channel_id(url)
{
    let req_options = {
        host: "www.rtp.pt",
        port: 443,
        path: url,
        method: "GET",
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Cookie": "rtp_cookie_parental=0; rtp_privacy=666; rtp_cookie_privacy=permit 1,2,3,4; googlepersonalization=1; _recid="
        }
    };

    let res = await https_request(req_options);

    if(res.statusCode != 200)
    {
        let e = new Error("Request unsuccessfull (" + res.statusCode + ")");

        e.details = res.body;

        throw e;
    }

    if(!res.body)
        throw new Error("Invalid body");

    let live = res.body.toString("utf-8").indexOf("area=\"em-direto\";") != -1;

    if(!live)
        throw new Error("Invalid stream type. Channel ID only available for live channels");

    let root = HTML.parse(res.body.toString("utf-8"));

    for(let script of root.getElementsByTagName("script"))
    {
        if(script.text.indexOf("liveMetadata") == -1)
            continue;

        let cid_match = script.text.match(/liveMetadata\(\'([0-9]+)\'/);

        if(!cid_match)
            throw new Error("No channel ID found");

        return parseInt(cid_match[1]);
    }
}
async function rtp_get_channel_live_metadata(cid, cnt_prev = 0, cnt_next = 1)
{
    // NOTE: Currently RTP seems to ignore cnt_prev and cnt_next and only returns the current program and the next one.
    // Until they fix this, we'll just return the current program and the next one.

    let req_options = {
        host: "www.rtp.pt",
        port: 443,
        path: "/play/livechannelmetadata.php?channel=" + cid + "&howmanynext=" + cnt_next + "&howmanybefore=" + cnt_prev,
        method: "GET",
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Cookie": "rtp_cookie_parental=0; rtp_privacy=666; rtp_cookie_privacy=permit 1,2,3,4; googlepersonalization=1; _recid="
        }
    };

    let res = await https_request(req_options);

    if(res.statusCode != 200)
    {
        let e = new Error("Request unsuccessfull (" + res.statusCode + ")");

        e.details = res.body;

        throw e;
    }

    if(!res.body)
        throw new Error("Invalid body");

    let res_json = JSON.parse(res.body.toString("utf-8"));

    let ret = {
        current: {},
        next: [],
        prev: []
    };

    let root = HTML.parse(atob(res_json["LiveContentData"]));

    for(let child of root.childNodes)
    {
        if(!child || !child.tagName || child.tagName.toLowerCase() != "div")
            continue;

        if(child.getAttribute("class").indexOf("live-noar") == -1)
            continue;

        for(let div of child.childNodes)
        {
            if(!div || !div.tagName || div.tagName.toLowerCase() != "div")
                continue;

            let is_current = false;
            let program = {
                name: ""
            };

            for(let b of div.getElementsByTagName("b"))
            {
                if(b.getAttribute("itemprop") != "name")
                    continue;

                program.name = b.textContent;

                break;
            }

            for(let span of div.getElementsByTagName("span"))
            {
                if(span.getAttribute("class").indexOf("stamp") == -1)
                    continue;

                is_current = span.textContent === "NO AR";

                break;
            }

            if(is_current)
                ret.current.name = program.name;
            else // TODO: Support prev when RTP supports it
                ret.next.push(program);
        }

        break;
    }

    let current_program_root = HTML.parse(atob(res_json["_EPISODIOS_"]));

    if(current_program_root.childNodes.length != 1)
        throw new Error("Invalid current program metadata");

    let current_url = current_program_root.childNodes[0].getAttribute("href");

    ret.current.url = current_url,
    ret.current.pid = parseRTPUrl(current_url).pid

    return ret;
}

async function run()
{
    let opts = program.opts();

    if(!opts.url && !opts.channel && !opts.pid)
    {
        console.log("Missing options");
        console.log("No 'url' or 'pid'/'channel'/'live' combination set");

        return process.exit(1);
    }

    if(opts.url && (opts.channel || opts.pid || opts.live))
    {
        console.log("Invalid options provided");
        console.log("Choose either 'url' or 'pid'/'channel'/'live'");

        return process.exit(1);
    }

    if(opts.url)
    {
        if(opts.url.channel)
        {
            opts.live = true;
            opts.channel = opts.url.channel;
        }
        else if(opts.url.pid)
        {
            opts.live = false;
            opts.pid = opts.url.pid;
            opts.eid = opts.url.eid;
        }
        else
        {
            console.log("Invalid url");
            console.log("No channel or program ID found in URL");

            return process.exit(1);
        }
    }

    console.log(opts.url ? opts.url.url : "No URL");
    console.log(opts.live);
    console.log(opts.pid || opts.channel);
    console.log(opts.eid || "No episode");

    let ep_url;

    if(!opts.live)
    {
        console.log(await rtp_get_program_name(program.opts().pid));
        console.log(await rtp_get_program_seasons(program.opts().pid));
        let eps = await rtp_get_program_episodes(program.opts().pid);
        console.log(eps);
        ep_url = eps[0].url;
    }
    else
    {
        ep_url = "/play/direto/" + opts.channel;
    }

    console.log(ep_url);

    let stream_url = await rtp_get_stream_url(ep_url);

    console.log(stream_url);

    if(opts.live)
    {
        let cid = await rtp_get_channel_id(ep_url);
        console.log(cid);
        console.log(await rtp_get_channel_live_metadata(cid));
    }

    let parser = m3u8_request(stream_url);

    parser.on(
        "item",
        function (data)
        {
            console.log(data);
            console.log(url_rewrite(stream_url, data.url));
        }
    );
    parser.once(
        "stream",
        function (data)
        {
            console.log(data);

            let full_url = url_rewrite(stream_url, data.url);

            console.log(full_url);

            let parser2 = m3u8_request(full_url);

            parser2.on(
                "item",
                function (data)
                {
                    //console.log(data);
                    console.log(url_rewrite(stream_url, data.url));
                }
            );
            parser2.on("end",
                function ()
                {
                    console.log("End item playlist");
                }
            );
        }
    );
    parser.on("end",
        function ()
        {
            console.log("End stream playlist");
        }
    );
}

async function main()
{
    program
        .option("-p, --pid <program-id>", "Program ID from RTP", parseInt)
        .option("-l, --live", "Toggle live mode, to record live RTP channels")
        .option("-c, --channel <channel-name>", "Specify RTP channel name when using live mode")
        .option("-u, --url <rtp-url>", "Specify an RTP URL, automatically detects live channel name and/or program ID", parseRTPUrl)
        .option("-d, --debug", "Print debugging information")
        .action(run);

    await program.parseAsync();
}

main();

// Commands for testing
// node src/index.js -u https://www.rtp.pt/play/direto/rtp1
// node src/index.js -u https://www.rtp.pt/play/p9317/e571868/doce
// node src/index.js -u https://www.rtp.pt/play/p6755/auga-seca
// node src/index.js -p 1085