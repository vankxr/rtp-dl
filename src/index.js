const Path = require("path");
const FileSystem = require("fs");
const ChildProcess = require("child_process");
const HTTPS = require("https");
const { Command } = require("commander");
const HTML = require("node-html-parser");

const program = new Command();
const package = JSON.parse(FileSystem.readFileSync(Path.join(__dirname, "../package.json")));

program.version(package.version, "-v, --version", "Print the current version");
program.helpOption('-h, --help', 'Display this help information');
program.showHelpAfterError();
program.showSuggestionAfterError();

function parseRTPUrl(url)
{
    let pid_match = url.match(/play\/p?(\d+)/);

    if(pid_match)
        return parseInt(pid_match[1]);

    let live_match = url.match(/direto\/([a-zA-Z0-9]+)/);

    if(live_match)
        return live_match[1];

    return null;
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
    let articles = root.getElementsByTagName("article");
    let first_article = articles[0];

    if(!first_article)
        throw new Error("Program not found");

    let as = first_article.getElementsByTagName("a");
    let first_a = as[0];

    if(!first_a)
        throw new Error("Program not found");

    let program_name = first_a.getAttribute("title");

    if(!program_name)
        throw new Error("Program not found");

    return program_name.split(" - ")[0];
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
            let a = article.getElementsByTagName("a");
            let first_a = a[0];

            if(!first_a)
                continue;

            let episode = {};

            episode.url = first_a.getAttribute("href");
            episode.title = first_a.getAttribute("title");

            for(let div of first_a.childNodes)
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
async function rtp_get_program_stream(url)
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

        let f_match = [...script.text.matchAll(/hls\s?:\s(atob\(\s)?decodeURIComponent\(\[(\"([^\"]+)\"(\,)?)+\].join\(\"\"\)\)/g)];

        if(!f_match)
            throw new Error("No stream found");

        f_match = f_match.map(m => m[0]);

        let f_str;

        if(on_demand)
            f_str = f_match[f_match.length - 1];
        else if(live)
            f_str = f_match[0];

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

    if(typeof opts.url == "string")
    {
        opts.live = true;
        opts.channel = opts.url;
    }
    else if(typeof opts.url == "number")
    {
        opts.live = false;
        opts.pid = opts.url;
    }

    console.log(opts.url);
    console.log(opts.live);
    console.log(opts.pid || opts.channel);

    let ep_url;

    if(!opts.live)
    {
        console.log(await rtp_get_program_name(program.opts().pid));
        let eps = await rtp_get_program_episodes(program.opts().pid);
        console.log(eps);
        ep_url = eps[0].url;
    }
    else
    {
        ep_url = "/play/direto/" + opts.channel;
    }

    console.log(ep_url);
    console.log(await rtp_get_program_stream(ep_url));
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