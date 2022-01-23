const Stream = require("stream");

class M3U8Parser extends Stream.Writable
{
    constructor()
    {
        super();

        this._lastLine = "";
        this._seq = 0;
        this._nextItemDuration = null;
        this._nextItemRange = null;
        this._nextItemAttrs = null;
        this._nextItemIsStream = false;
        this._lastItemRangeEnd = 0;
        this._init = false;

        this.on(
            "finish",
            function ()
            {
                this._parseLine(this._lastLine);
                this.emit("end");
            }.bind(this)
        );
    }

    _parseAttrList(value)
    {
        let attrs = {};
        let regex = /([A-Z0-9-]+)=(?:(?:"([^"]*)")|([^,]*))/g;
        let match;

        while ((match = regex.exec(value)) !== null)
            attrs[match[1].toLowerCase()] = match[2] || match[3];

        return attrs;
    }

    _parseRange(value)
    {
        if (!value)
            return null;

        let svalue = value.split("@");
        let start = svalue[1] ? parseInt(svalue[1]) : this._lastItemRangeEnd + 1;
        let end = start + parseInt(svalue[0]) - 1;
        let range = { start, end };

        this._lastItemRangeEnd = range.end;

        return range;
    }

    _parseLine(line)
    {
        let match = line.match(/^#(EXT[A-Z0-9-]+)(?::(.*))?/);

        if (match)
        {
            const tag = match[1];
            const value = match[2] || "";

            switch (tag)
            {
                case "EXT-X-PROGRAM-DATE-TIME":
                    this.emit("starttime", new Date(value).getTime());
                break;
                case "EXT-X-MEDIA-SEQUENCE":
                    this._seq = parseInt(value);
                break;
                case "EXT-X-MAP":
                {
                    let attrs = this._parseAttrList(value);

                    if (!attrs.uri)
                    {
                        this.destroy(new Error("`EXT-X-MAP` found without required attribute `URI`"));

                        return;
                    }

                    this.emit(
                        "item",
                        {
                            url: attrs.uri,
                            seq: this._seq,
                            init: true,
                            duration: 0,
                            range: this._parseRange(attrs.byterange),
                        }
                    );
                }
                break;
                case "EXT-X-BYTERANGE":
                    this._nextItemRange = this._parseRange(value);
                break;
                case "EXTINF":
                    this._nextItemDuration = Math.round(parseFloat(value.split(",")[0]) * 1000);
                break;
                case "EXT-X-STREAM-INF":
                {
                    this._nextItemIsStream = true;
                    this._nextItemAttrs = this._parseAttrList(value);
                }
                break;
                case "EXT-X-ENDLIST":
                    this.emit("endlist");
                break;
            }
        }
        else if (!/^#/.test(line) && line.trim())
        {
            if(this._nextItemIsStream)
            {
                this._nextItemAttrs = this._nextItemAttrs || {};
                this._nextItemAttrs.url = line.trim();

                this.emit("stream", this._nextItemAttrs);
            }
            else
            {
                this.emit(
                    "item",
                    {
                        url: line.trim(),
                        seq: this._seq++,
                        duration: this._nextItemDuration,
                        range: this._nextItemRange,
                    }
                );
            }

            this._nextItemRange = null;
            this._nextItemAttrs = null;
            this._nextItemIsStream = false;
        }
    }

    _write(chunk, encoding, callback)
    {
        let lines = chunk.toString("utf8").split("\n");

        if(!this._init && lines[0] !== "#EXTM3U")
            return this.emit("error", new Error("Invalid M3U8 payload (" + lines[0] + ")"));

        this._init = true;

        if (this._lastLine)
            lines[0] = this._lastLine + lines[0];

        lines.forEach(
            function (line, i)
            {
                if (this.destroyed)
                    return;

                if (i < lines.length - 1)
                    this._parseLine(line);
                else
                    this._lastLine = line;
            }.bind(this)
        );

        callback();
    }
}

module.exports = M3U8Parser;