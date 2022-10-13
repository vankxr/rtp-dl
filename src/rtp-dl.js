const OS = require("os");
const Path = require("path");
const FileSystem = require("fs");
const ZLib = require("zlib");
const ChildProcess = require("child_process");
const HTTPS = require("https");
const URL = require("url");
const { Command, Option } = require("commander");
const HTML = require("node-html-parser");
const Colors = require("colors");
const M3U8Parser = require("../lib/m3u8parser.js");
const Queue = require("../lib/queue.js");

let M3U8_USE_USER_AGENT = true;

const ffmpeg_bin_name = "ffmpeg-" + process.platform + (process.platform === "win32" ? ".exe" : "");
const ffmpeg_source_path = Path.join(__dirname, "..", "assets", "bin", "ffmpeg", ffmpeg_bin_name);
const ffmpeg_install_path = Path.join(OS.tmpdir(), "rtp-dl", "assets", "bin", "ffmpeg", ffmpeg_bin_name);

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

function install_ffmpeg()
{
    if(FileSystem.existsSync(ffmpeg_install_path))
        return;

    console.log("Installing ffmpeg...");

    FileSystem.mkdirSync(Path.dirname(ffmpeg_install_path), { recursive: true });

    if(process.pkg)
        FileSystem.writeFileSync(ffmpeg_install_path, FileSystem.readFileSync(ffmpeg_source_path));
    else
        FileSystem.copyFileSync(ffmpeg_source_path, ffmpeg_install_path);

    if(process.platform === "linux")
        ChildProcess.execSync("chmod +x " + ffmpeg_install_path);
}
function escape_path(str)
{
    if(typeof str !== "string")
        return str;

    return str.replace(/[\\|\/|\"|\'|\.]/g, "");
}
function clean_str(input)
{
    var output = "";

    for(let i = 0; i < input.length; i++)
        if(input.charCodeAt(i) <= 127)
            output += input.charAt(i);

    return output;
}
function date_str(date)
{
    return date.getDate() + "-" + (date.getMonth() + 1) + "-" + date.getFullYear();
}
function parseRTPUrl(url)
{
    let pid_match = url.match(/play(\/([a-z]+))?\/p(\d+)(\/e(\d+))?/);

    if(pid_match)
        return {
            url: url,
            type: pid_match[2],
            pid: parseInt(pid_match[3]),
            eid: parseInt(pid_match[5])
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
function humanize(value, units = ["B", "KiB", "MiB", "GiB", "TiB"], mul_size = 1024, decimals = 2)
{
    let i = 0;

    while(value >= mul_size)
    {
        value /= mul_size;
        i++;
    }

    return value.toFixed(decimals) + " " + units[i];
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
        async function (resolve, reject)
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

                            if(res.headers["content-encoding"] === "gzip")
                                res.body = ZLib.gunzipSync(res.body);
                            else if(res.headers["content-encoding"])
                                throw new Error("Unsupported content encoding: " + res.headers["content-encoding"]);

                            if(res.headers.location && (res.statusCode === 301 || res.statusCode === 302))
                            {
                                options.path = res.headers.location;

                                return https_request(options, body).then(resolve, reject);
                            }

                            return resolve(res);
                        }
                    );
                }
            );

            req.on("error", reject);

            if(body)
                req.write(body);

            req.end();
        }
    );
}
function ts_request(frag_url, cb)
{
    let url_data = URL.parse(frag_url);
    let req_options = {
        host: url_data.host,
        port: 443,
        path: url_data.path,
        method: "GET",
        headers: {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36"
        }
    };

    if(!M3U8_USE_USER_AGENT)
        delete req_options.headers["User-Agent"];

    const req = HTTPS.request(
        req_options,
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

                    if(res.headers["content-encoding"] === "gzip")
                        res.body = ZLib.gunzipSync(res.body);
                    else if(res.headers["content-encoding"])
                        cb(new Error("Unsupported content encoding: " + res.headers["content-encoding"]));

                    cb(null, res.body);
                }
            );
        }
    );

    req.on("error", cb);
    req.end();
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
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36"
        }
    };

    if(!M3U8_USE_USER_AGENT)
        delete req_options.headers["User-Agent"];

    const parser = new M3U8Parser();
    const req = HTTPS.request(
        req_options,
        function (res)
        {
            if(res.headers["content-encoding"] === "gzip")
            {
                // Took me a sec to figure out that RTP sometimes responds with gzipped payload
                // Even though the request does not claim to accept gzip
                // This seems to happen at random times, and is most frequent for secondary channels (i.e. not RTP1)
                let gunzip = ZLib.createGunzip();

                res.pipe(gunzip);
                gunzip.pipe(parser);
            }
            else if(res.headers["content-encoding"])
            {
                parser.end();
            }
            else
            {
                res.pipe(parser);
            }
        }
    )

    req.end();

    return parser;
}
async function get_streams(master_url)
{
    return new Promise(
        function (resolve, reject)
        {
            let streams = [];
            let parser = m3u8_request(master_url);

            parser.on(
                "stream",
                function (data)
                {
                    // Bypasses autist "protection" by RTP
                    if(data.url.indexOf("http") === -1)
                        data.url = url_rewrite(master_url, data.url);

                    streams.push(data);
                }
            );

            parser.once(
                "end",
                function ()
                {
                    parser.removeAllListeners("stream");
                    parser.removeAllListeners("error");

                    return resolve(streams);
                }
            );

            parser.once(
                "error",
                function (e)
                {
                    parser.removeAllListeners("stream");
                    parser.removeAllListeners("end");

                    return reject(e);
                }
            );
        }
    );
}
async function get_ts_fragments(stream_url)
{
    return new Promise(
        function (resolve, reject)
        {
            let frags = [];
            let parser = m3u8_request(stream_url);

            parser.on(
                "item",
                function (data)
                {
                    // Bypasses autist "protection" by RTP
                    if(data.url.indexOf("http") === -1)
                        data.url = url_rewrite(stream_url, data.url);

                    frags.push(data);
                }
            );

            parser.once(
                "end",
                function ()
                {
                    parser.removeAllListeners("item");
                    parser.removeAllListeners("error");

                    return resolve(frags);
                }
            );

            parser.once(
                "error",
                function (e)
                {
                    parser.removeAllListeners("stream");
                    parser.removeAllListeners("end");

                    return reject(e);
                }
            );
        }
    );
}
async function download_vod(stream_url, file_name)
{
    return new Promise(
        async function (resolve, reject)
        {
            let frags = await get_ts_fragments(stream_url);

            if(frags.length === 0)
                return reject(new Error("No fragments found"));

            let q = new Queue(ts_request);
            let ffmpeg = ChildProcess.spawn(
                ffmpeg_install_path,
                [
                    "-y",
                    "-f",
                    "mpegts",
                    "-i",
                    "pipe:0",
                    "-c:v",
                    "copy", // TODO: Add transcoding support
                    "-c:a",
                    "copy", // TODO: Add transcoding support
                    file_name
                ],
                {
                    cwd: process.cwd(),
                    detached: true
                }
            );

            ffmpeg.once(
                "close",
                function (code)
                {
                    q.kill();

                    ffmpeg.removeAllListeners("error");

                    if(code !== 0)
                        return reject(new Error("Transmuxing/transcoding failed with code " + code));

                    return resolve();
                }
            );

            ffmpeg.on(
                "error",
                function (e)
                {
                    q.kill();

                    ffmpeg.removeAllListeners("close");

                    return reject(e);
                }
            );

            ffmpeg.stderr.on(
                "data",
                function (data)
                {
                    //console.log("ffmpeg stderr: " + data.toString());
                }
            );

            ffmpeg.once(
                "spawn",
                function ()
                {
                    function ts_req_cb(e, data)
                    {
                        if(e)
                        {
                            q.kill();
                            ffmpeg.stdin.end();

                            ffmpeg.removeAllListeners("close");
                            ffmpeg.removeAllListeners("error");

                            return reject(e);
                        }

                        if(ffmpeg.stdin.writable)
                            ffmpeg.stdin.write(data);
                    }

                    q.once(
                        "end",
                        function ()
                        {
                            ffmpeg.stdin.end();
                        }
                    );

                    frags.forEach(
                        function (frag)
                        {
                            q.push(frag.url, ts_req_cb);
                        }
                    );
                }
            );
        }
    );
}
async function download_live(stream_url, file_name)
{
    return new Promise(
        function (resolve, reject)
        {
            let update = true;

            let q = new Queue(ts_request);
            let ffmpeg = ChildProcess.spawn(
                ffmpeg_install_path,
                [
                    "-y",
                    "-f",
                    "mpegts",
                    "-i",
                    "pipe:0",
                    "-c:v",
                    "copy", // TODO: Add transcoding support
                    "-c:a",
                    "copy", // TODO: Add transcoding support
                    file_name
                ],
                {
                    cwd: process.cwd(),
                    detached: true
                }
            );

            ffmpeg.once(
                "close",
                function (code)
                {
                    q.kill();
                    update = false;

                    process.removeAllListeners("SIGINT");
                    ffmpeg.removeAllListeners("error");

                    if(code !== 0)
                        return reject(new Error("Transmuxing/transcoding failed with code " + code));

                    console.log("Transmuxing/transcoding process finished (" + code + ")");

                    return resolve();
                }
            );

            ffmpeg.once(
                "error",
                function (e)
                {
                    q.kill();
                    update = false;

                    process.removeAllListeners("SIGINT");
                    ffmpeg.removeAllListeners("close");

                    return reject(e);
                }
            );

            ffmpeg.stderr.on(
                "data",
                function (data)
                {
                    //console.log("ffmpeg stderr: " + data.toString());
                }
            );

            ffmpeg.once(
                "spawn",
                async function ()
                {
                    function ts_req_cb(e, data)
                    {
                        if(e)
                        {
                            q.kill();
                            ffmpeg.stdin.end();
                            update = false;

                            process.removeAllListeners("SIGINT");
                            ffmpeg.removeAllListeners("close");
                            ffmpeg.removeAllListeners("error");

                            return reject(e);
                        }

                        if(ffmpeg.stdin.writable)
                            ffmpeg.stdin.write(data);
                    }

                    let last_frag_seq = 0;

                    process.once(
                        "SIGINT",
                        function ()
                        {
                            console.log("Got SIGINT, stopping fragment updates");
                            console.log("Please wait for the list of fragments to drain");

                            update = false;

                            if(q.tasks.length + q.active > 0)
                            {
                                q.once(
                                    "end",
                                    function ()
                                    {
                                        console.log("Fragment queue drained, stopping transcode/transmux");

                                        ffmpeg.stdin.end();
                                    }
                                );
                            }
                            else
                            {
                                console.log("Fragment queue drained, stopping transcode/transmux");

                                ffmpeg.stdin.end();
                            }
                        }
                    );

                    while(update)
                    {
                        let frags = [];
                        let frag_cnt = 0;
                        let frag_duration = 0;

                        try
                        {
                            frags = await get_ts_fragments(stream_url);
                        }
                        catch(e)
                        {
                            frags = [];
                        }

                        if(frags.length > 0)
                        {
                            frags.forEach(
                                function (frag)
                                {
                                    if(frag.seq > last_frag_seq || (last_frag_seq > 60000 && frag.seq < 1000))
                                    {
                                        let frags_lost = frag.seq - last_frag_seq - 1;

                                        if(last_frag_seq > 0 && frags_lost > 0)
                                            console.log("Lost " + frags_lost + " fragments");

                                        q.push(frag.url, ts_req_cb);

                                        frag_cnt++;
                                        frag_duration += frag.duration;
                                        last_frag_seq = frag.seq;
                                    }
                                }
                            );

                            console.log("Added " + frag_cnt + " fragments, " + frag_duration + " ms duration, new max " + last_frag_seq);
                        }

                        await sleep(frag_cnt > 0 ? Math.max(5000, Math.round(frag_duration / frag_cnt * 5)) : 2000); // Set timer for approx. 5 fragments
                    }
                }
            );
        }
    );
}
async function download_mp3(url, file_name)
{
    return new Promise(
        async function (resolve, reject)
        {
            let ffmpeg = ChildProcess.spawn(
                ffmpeg_install_path,
                [
                    "-y",
                    "-f",
                    "mp3",
                    "-i",
                    "pipe:0",
                    "-c:v",
                    "copy", // TODO: Add transcoding support
                    "-c:a",
                    "copy", // TODO: Add transcoding support
                    file_name
                ],
                {
                    cwd: process.cwd(),
                    detached: true
                }
            );

            ffmpeg.once(
                "close",
                function (code)
                {
                    ffmpeg.removeAllListeners("error");

                    if(code !== 0)
                        return reject(new Error("Transmuxing/transcoding failed with code " + code));

                    return resolve();
                }
            );

            ffmpeg.on(
                "error",
                function (e)
                {
                    ffmpeg.removeAllListeners("close");

                    return reject(e);
                }
            );

            ffmpeg.stderr.on(
                "data",
                function (data)
                {
                    //console.log("ffmpeg stderr: " + data.toString());
                }
            );

            ffmpeg.once(
                "spawn",
                function ()
                {
                    let url_data = URL.parse(url);
                    let req_options = {
                        host: url_data.host,
                        port: 443,
                        path: url_data.path,
                        method: "GET",
                        headers: {
                            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36"
                        }
                    };

                    const req = HTTPS.request(
                        req_options,
                        function (res)
                        {
                            if(res.headers["content-encoding"] === "gzip")
                            {
                                // Took me a sec to figure out that RTP sometimes responds with gzipped payload
                                // Even though the request does not claim to accept gzip
                                // This seems to happen at random times, and is most frequent for secondary channels (i.e. not RTP1)
                                let gunzip = ZLib.createGunzip();

                                res.pipe(gunzip);
                                gunzip.pipe(ffmpeg.stdin);
                            }
                            else if(res.headers["content-encoding"])
                            {
                                return reject(new Error("Unsupported content encoding: " + res.headers["content-encoding"]));
                            }
                            else
                            {
                                res.pipe(ffmpeg.stdin);
                            }
                        }
                    )

                    req.end();
                }
            );
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
    let url = await rtp_get_program_episodes(pid, true); // Retrieve just one episode URL

    if(typeof url !== "string" && url.url)
        url = url.url;

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
                url: parseRTPUrl(season.getAttribute("href"))
            };
        }
    );

    seasons = seasons.filter(season => (!isNaN(season.number) && season.number > 0));

    return seasons;
}
async function rtp_get_program_episodes(pid, single_url = false, skip_parts = false)
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

            if(single_url)
                return a.getAttribute("href");

            episode.url = parseRTPUrl(a.getAttribute("href"));
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

            if(skip_parts)
            {
                episode.parts = [
                    {
                        number: 1
                    }
                ];
            }
            else
            {
                try
                {
                    episode.parts = await rtp_get_episode_parts(episode.url.url);
                }
                catch(e)
                {
                    episode.parts = [
                        {
                            number: 1
                        }
                    ];
                }
            }

            episodes.push(episode);
        }

        page++;
    }

    return episodes;
}
async function rtp_get_episode_parts(url)
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

    let root = HTML.parse(res.body.toString("utf-8"));

    let parts_ul = root.getElementsByTagName("ul").find(
        function (ul)
        {
            if(!ul.getAttribute("class"))
                return false;

            if(ul.getAttribute("class").indexOf("parts") == -1)
                return false;

            return true;
        }
    );

    if(!parts_ul)
        throw new Error("Parts ul not found");

    let parts = parts_ul.getElementsByTagName("li");

    if(!parts)
        throw new Error("No parts found");

    parts = parts.map(
        function (part)
        {
            if(!part.childNodes || !part.childNodes[0])
                return;

            let child = part.childNodes[0];

            if(!child.getAttribute("title"))
                return;

            let p_match = child.text.match(/PARTE\s([0-9]+)/);

            if(!p_match)
                return;

            let number = parseInt(p_match[1]);

            if(isNaN(number) || number < 1)
                return;

            let p = {};

            p.number = number;

            if(child.getAttribute("title"))
                p.title = child.getAttribute("title");

            if(child.getAttribute("href"))
                p.url = parseRTPUrl(child.getAttribute("href"));

            return p;
        }
    );

    return parts;
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

        // Handle plain URL video programs
        //// URL regex stolen from https://stackoverflow.com/a/3809435 :)
        //// Editted to include the 'fps|hls: "...",´
        f_match = script.text.match(/(fps|hls)\s?:\s\"(https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*))\"\,/);

        if(f_match)
            return f_match[1];

        // Now handle encoded video programs
        f_match = [...script.text.matchAll(/(fps|hls)\s?:\s(atob\(\s)?decodeURIComponent\(\[(\"([^\"]+)\"(\,)?)+\].join\(\"\"\)\)/g)];

        if(!f_match.length)
            throw new Error("No stream found");

        f_match = f_match.map(m => m[0]);

        let f_str = f_match[f_match.length - 1];

        if(!f_str)
            throw new Error("No stream found");

        let c_match = [...f_str.matchAll(/\"([^\"]+)\"(\,)?/g)];

        if(!c_match.length)
            throw new Error("No stream found");

        c_match = c_match.map(m => m[1])

        let url;

        if(on_demand)
            url = atob(decodeURIComponent(c_match.join("")));
        if(live)
            url = decodeURIComponent(c_match.join(""));

        url = url.replace("drm-fps", "hls");

        return url;
    }
}
async function rtp_get_channel_info(url)
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
        throw new Error("Invalid stream type. Channel info only available for live channels");

    let root = HTML.parse(res.body.toString("utf-8"));

    for(let script of root.getElementsByTagName("script"))
    {
        if(script.text.indexOf("liveMetadata") == -1 || script.text.indexOf("artist:") == -1)
            continue;

        let cid_match = script.text.match(/liveMetadata\(\'([0-9]+)\'/);
        let cname_match = script.text.match(/artist: \"([^"]+)\",/);

        if(!cid_match)
            throw new Error("No channel ID found");

        if(!cname_match)
            throw new Error("No channel name found");

        return {
            cid: parseInt(cid_match[1]),
            name: cname_match[1]
        };
    }
}
async function rtp_get_channel_program_metadata(cid, cnt_prev = 0, cnt_next = 1)
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
        return ret;

    let current_url = current_program_root.childNodes[0].getAttribute("href");

    ret.current.url = parseRTPUrl(current_url);

    return ret;
}
async function rtp_get_channel_epg(channel, date)
{
    let req_options = {
        host: "www.rtp.pt",
        port: 443,
        path: "/EPG/json/rtp-home-page-tv-radio/list-all-grids/tv/" + (date ? date_str(date) : ""),
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

    if(!res_json.result)
        throw new Error("Invalid result");

    let chan_epg = null;

    for(const chan of Object.keys(res_json.result))
    {
        let chan2 = chan.toLowerCase().replace(/\-/g, "");

        if(chan2.indexOf(channel.toLowerCase()) == -1)
            continue;

        chan_epg = res_json.result[chan];

        break;
    }

    if(!chan_epg)
        throw new Error("EPG not available for this channel");

    let epg = [];

    if(chan_epg.morning)
        epg.push(...chan_epg.morning);

    if(chan_epg.afternoon)
        epg.push(...chan_epg.afternoon);

    if(chan_epg.evening)
        epg.push(...chan_epg.evening);

    for(let i = 0; i < epg.length; i++)
    {
        let epg_item = epg[i];

        if(epg_item.date)
            epg[i].date = new Date(epg_item.date);

        if(typeof epg_item.name == "string")
            epg[i].name = epg_item.name.trim();

        if(typeof epg_item.description == "string")
            epg[i].description = epg_item.description.trim();

        if(epg_item.url)
        {
            epg[i].epg_url = epg_item.url;

            delete epg[i].url;
        }

        if(epg_item.review)
        {
            epg[i].url = parseRTPUrl(epg_item.review);

            delete epg[i].review;
        }

        delete epg[i].image;
        delete epg[i].liveUrl;
    }

    return epg;
}

async function run()
{
    let opts = program.opts();

    if(!opts.url && !opts.channel && !opts.pid)
    {
        console.log("Missing options");
        console.log("No 'url' or 'pid'/'channel' combination set");

        return process.exit(1);
    }

    if(opts.url && (opts.channel || opts.pid))
    {
        console.log("Invalid options provided");
        console.log("Choose either 'url' or 'pid'/'channel'");

        return process.exit(1);
    }

    if(opts.channel)
        opts.live = true;

    if(opts.url)
    {
        const supported_types = [undefined, "palco"];

        if(supported_types.indexOf(opts.url.type) == -1)
        {
            console.log("Invalid url");
            console.log("Unsupported URL type '" + opts.url.type + "'");

            return process.exit(1);
        }

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

    install_ffmpeg();

    //console.log(opts.url ? opts.url.url : "No URL");
    //console.log(opts.live);
    //console.log(opts.pid || opts.channel);
    //console.log(opts.eid || "No episode");

    let file_path = "";
    let file_prefix = "";

    if(!opts.live)
    {
        console.log("Fething data for program ID " + opts.pid + "...");

        let program_name = await rtp_get_program_name(opts.pid);

        console.log("Program ID: " + opts.pid);
        console.log("Program name: " + program_name);

        file_path = "p" + opts.pid;
        file_prefix += escape_path(program_name);

        let program_seasons = await rtp_get_program_seasons(opts.pid);

        console.log("Program seasons: " + (program_seasons.length > 0 ? program_seasons.map(season => season.number) : 1));

        if(program_seasons.length > 0)
            console.log("Selected season: " + program_seasons.find(s => s.url.pid == opts.pid).number);

        let ep_timeout = setTimeout(
            function ()
            {
                console.log("Episode fetching is taking a long time, you should consider using the '--skip-parts' option");
            },
            5000
        );

        let program_eps = await rtp_get_program_episodes(opts.pid, false, opts.skipParts);

        clearTimeout(ep_timeout);

        //console.log(program_eps[0]);

        console.log("Program episodes: " + program_eps.length);

        let eps;

        if(opts.eid)
        {
            let selected_ep = program_eps.find(e => e.url.eid == opts.eid);

            if(!selected_ep)
            {
                console.log("Episode not found in program");

                return process.exit(1);
            }

            console.log("Selected episode: " + selected_ep.id);

            eps = [selected_ep];
        }
        else
        {
            console.log("All episodes selected");

            eps = program_eps;
        }

        for(let i = 0; i < eps.length; i++)
        {
            let ep = eps[i];

            for(let j = 0; j < ep.parts.length; j++)
            {
                let part = ep.parts[j];

                if(ep.parts.length > 1)
                    console.log("Fething data for part " + part.number + " of episode " + (i + 1) + "/" + eps.length + "...");
                else
                    console.log("Fething data for episode " + (i + 1) + "/" + eps.length + "...");

                let ep_url = ep.url.url;

                if(part.url)
                    ep_url = part.url.url;

                console.log("Episode URL: " + ep_url);

                let master_url = await rtp_get_stream_url(ep_url);

                console.log("Master stream URL: " + master_url);

                let file_name = file_prefix;

                file_name += " - " + (ep.id ? escape_path(ep.id) : ("Ep " + (i + 1)));

                if(ep.title)
                    file_name += " - " + escape_path(ep.title)

                if(ep.parts.length > 1)
                    file_name += " - Part " + part.number;

                if(!opts.outputDir)
                    opts.outputDir = ".";

                file_name += "." + opts.outputFormat;
                file_name = Path.join(process.cwd(), opts.outputDir, file_path, file_name);
                file_name = clean_str(file_name);

                if(master_url.indexOf(".m3u8") !== -1)
                {
                    let streams;

                    try
                    {
                        M3U8_USE_USER_AGENT = true;
                        streams = await get_streams(master_url);
                    }
                    catch(e)
                    {
                        console.log("Failed to get streams with user agent, trying without...");

                        try
                        {
                            M3U8_USE_USER_AGENT = false;
                            streams = await get_streams(master_url);
                        }
                        catch(e)
                        {
                            console.log("Failed to get streams without user agent, aborting...");
                            console.error(e);

                            return process.exit(1);
                        }
                    }

                    let stream;

                    if(streams.length > 0)
                    {
                        console.log("Found " + streams.length + " streams");

                        for(let i = 0; i < streams.length; i++)
                        {
                            console.log("  Stream " + (i + 1) + ":");

                            const stream = streams[i];

                            if(stream.bandwidth)
                                console.log("    Bandwidth: " + humanize(parseInt(stream.bandwidth), ["bps", "kbps", "Mbps"]));

                            if(stream.resolution)
                                console.log("    Resolution: " + stream.resolution);

                            if(stream["frame-rate"])
                                console.log("    Frame rate: " + stream["frame-rate"]);

                            if(stream.codecs)
                                console.log("    Codecs: " + stream.codecs);

                            if(stream["video-range"])
                                console.log("    Video range: " + stream["video-range"]);
                        }

                        if(opts.listStreams)
                            return process.exit(0);

                        if(opts.stream < 1 || opts.stream > streams.length)
                            opts.stream = 1;

                        console.log("Using Stream " + opts.stream);

                        stream = streams[opts.stream - 1];
                    }
                    else
                    {
                        console.log("No streams found");

                        return process.exit(1);
                    }

                    console.log("Downloading to '" + file_name + "'...");

                    FileSystem.mkdirSync(Path.join(process.cwd(), opts.outputDir, file_path), { recursive: true });

                    if(opts.async)
                    {
                        download_vod(stream.url, file_name)
                            .then(
                                function ()
                                {
                                    console.log("Successfully downloaded '" + file_name + "'");
                                }
                            )
                            .catch(
                                function (e)
                                {
                                    console.log("Error downloading '" + file_name + "'");
                                    console.log(e);
                                }
                            );
                    }
                    else
                    {
                        try
                        {
                            await download_vod(stream.url, file_name);

                            console.log("Successfully downloaded '" + file_name + "'");
                        }
                        catch(e)
                        {
                            console.log("Error downloading '" + file_name + "'");
                            console.log(e);
                        }
                    }
                }
                else if(master_url.indexOf(".mp3") !== -1)
                {
                    console.log("Downloading to '" + file_name + "'...");

                    FileSystem.mkdirSync(Path.join(process.cwd(), opts.outputDir, file_path), { recursive: true });

                    if(opts.async)
                    {
                        download_mp3(master_url, file_name)
                            .then(
                                function ()
                                {
                                    console.log("Successfully downloaded '" + file_name + "'");
                                }
                            )
                            .catch(
                                function (e)
                                {
                                    console.log("Error downloading '" + file_name + "'");
                                    console.log(e);
                                }
                            );
                    }
                    else
                    {
                        try
                        {
                            await download_mp3(master_url, file_name);

                            console.log("Successfully downloaded '" + file_name + "'");
                        }
                        catch(e)
                        {
                            console.log("Error downloading '" + file_name + "'");
                            console.log(e);
                        }
                    }
                }
                else
                {
                    console.log("Unknown master stream format");

                    continue;
                }
            }
        }
    }
    else
    {
        console.log("Fething data for live channel " + opts.channel + "...");

        let chan_url = "/play/direto/" + opts.channel;
        let chan_info = await rtp_get_channel_info(chan_url);

        console.log("Channel ID: " + chan_info.cid);
        console.log("Channel Name: " + chan_info.name);

        file_path = "c" + chan_info.cid;
        file_prefix += escape_path(chan_info.name);

        if(opts.listEpg)
        {
            let epg = await rtp_get_channel_epg(opts.channel, new Date());

            for(let i = 0; i < epg.length; i++)
            {
                delete epg[i].description;

                if(typeof epg[i].url == "object")
                    epg[i].url = epg[i].url.url;

                epg[i].date = epg[i].date.toLocaleString("pt-PT", { timeZone: "Europe/Lisbon" });
            }

            console.table(epg);

            return process.exit(0);
        }

        let chan_metadata = await rtp_get_channel_program_metadata(chan_info.cid);

        console.log("Currently playing: " + chan_metadata.current.name);
        console.log("Next playing: " + chan_metadata.next[0].name);

        let master_url = await rtp_get_stream_url(chan_url);

        console.log("Master stream URL: " + master_url);

        let file_name = file_prefix;

        file_name += " - " + Math.round(new Date().getTime() / 1000);

        if(!opts.outputDir)
            opts.outputDir = ".";

        file_name += "." + opts.outputFormat;
        file_name = Path.join(process.cwd(), opts.outputDir, file_path, file_name);
        file_name = clean_str(file_name);

        if(master_url.indexOf(".m3u8") !== -1)
        {
            let streams;

            try
            {
                M3U8_USE_USER_AGENT = true;
                streams = await get_streams(master_url);
            }
            catch(e)
            {
                console.log("Failed to get streams with user agent, trying without...");

                try
                {
                    M3U8_USE_USER_AGENT = false;
                    streams = await get_streams(master_url);
                }
                catch(e)
                {
                    console.log("Failed to get streams without user agent, aborting...");
                    console.error(e);

                    return process.exit(1);
                }
            }

            let stream;

            if(streams.length > 0)
            {
                console.log("Found " + streams.length + " streams");

                for(let i = 0; i < streams.length; i++)
                {
                    console.log("  Stream " + (i + 1) + ":");

                    const stream = streams[i];

                    if(stream.bandwidth)
                        console.log("    Bandwidth: " + humanize(parseInt(stream.bandwidth), ["bps", "kbps", "Mbps"]));

                    if(stream.resolution)
                        console.log("    Resolution: " + stream.resolution);

                    if(stream["frame-rate"])
                        console.log("    Frame rate: " + stream["frame-rate"]);

                    if(stream.codecs)
                        console.log("    Codecs: " + stream.codecs);

                    if(stream["video-range"])
                        console.log("    Video range: " + stream["video-range"]);
                }

                if(opts.listStreams)
                    return process.exit(0);

                if(opts.stream < 1 || opts.stream > streams.length)
                    opts.stream = 1;

                console.log("Using Stream " + opts.stream);

                stream = streams[opts.stream - 1];
            }
            else
            {
                console.log("No streams found");

                return process.exit(1);
            }

            console.log("Downloading to '" + file_name + "'...");

            FileSystem.mkdirSync(Path.join(process.cwd(), opts.outputDir, file_path), { recursive: true });

            console.log("Press Ctrl + C to stop downloading");

            await download_live(stream.url, file_name);
        }
        else if(master_url.indexOf(".mp3") !== -1)
        {
            console.log("MP3 Live not supported yet!");

            process.exit(1);
        }
        else
        {
            console.log("Unknown master stream format");

            process.exit(1);
        }
    }
}

async function main()
{
    program
        .addOption(new Option("-p, --pid <program-id>", "Program ID from RTP").argParser(parseInt))
        .addOption(new Option("-c, --channel <channel-name>", "Specify RTP channel name when using live mode"))
        .addOption(new Option("-u, --url <rtp-url>", "Specify an RTP URL, automatically detects live channel name and/or program ID").argParser(parseRTPUrl))
        .addOption(new Option("-s, --stream <stream>", "Use this stream if multiple streams exist").argParser(parseInt).default(1))
        .addOption(new Option("-o, --output-dir <path>", "Set the output directory for media files").default(".", "Current working directory"))
        .addOption(new Option("-f, --output-format <format>", "Set the output file format").choices(["ts", "mp4", "mkv"]).default("ts", "ts (MPEG2 Transport Stream)"))
        .addOption(new Option("--skip-parts", "Skip episode part metadata fetching (for programs with lots of episodes, part metadata fetching can take quite a while)"))
        .addOption(new Option("-a, --async", "Download all episodes at the same time when there are multiple episodes"))
        .addOption(new Option("-S, --list-streams", "List available streams and exit"))
        .addOption(new Option("-E, --list-epg", "Print program guide and exit"))
        .addOption(new Option("-d, --debug", "Print debugging information"))
        .action(run);

    await program.parseAsync();
}

main();

// Commands for testing
// Live
// node src/rtp-dl.js -o out -u https://www.rtp.pt/play/direto/rtp1
// Specific episode
// node src/rtp-dl.js -o out -u https://www.rtp.pt/play/p9317/e571868/doce
// Multi season series
// node src/rtp-dl.js -o out -u https://www.rtp.pt/play/p6755/auga-seca
// Multi part, single episode program
// node src/rtp-dl.js -o out -u https://www.rtp.pt/play/palco/p9817/e592559/bonga-50-anos-de-carreira
// Program by id
// node src/rtp-dl.js -o out -p 1085 --skip-parts