# rtp-dl
RTP 🇵🇹 Media downloader written in NodeJS

Downloads Video and Audio streams from RTP. Can also pull a live stream until the user tells it to stop downloading. Currently working as a basic downloader and transmuxer, planning to add additional features such as progress bars, media transcoding and more advanced options in the future.

## Usage
```
$ rtp-dl --help
Usage: rtp-dl [options]

Options:
  -v, --version                 Print the current version
  -p, --pid <program-id>        Program ID from RTP
  -c, --channel <channel-name>  Specify RTP channel name when using live mode
  -u, --url <rtp-url>           Specify an RTP URL, automatically detects live channel name and/or program ID
  -s, --stream <stream>         Use this stream if multiple streams exist (default: 1)
  -o, --output-dir <path>       Set the output directory for media files (default: Current working directory)
  -f, --output-format <format>  Set the output file format (choices: "ts", "mp4", "mkv", default: ts (MPEG2 Transport
                                Stream))
  -S, --list-streams            List available streams and exit
  -E, --list-epg                Print program guide and exit
  -d, --debug                   Print debugging information
  -h, --help                    Display this help information
```

## Example
Downloading a season of a TV Series:
```
$ rtp-dl -u https://www.rtp.pt/play/p6755/auga-seca -f mp4
Fething data for program ID 6755...
Program ID: 6755
Program name: Auga Seca
Program seasons: 2
Selected season: 1
Program episodes: 6
All episodes selected
Fething data for episode 1 of 6...
Found 1 streams
  Stream 1:
    Bandwidth: 2.01 Mbps
    Resolution: 1920x1080
    Frame rate: 25.000
    Codecs: avc1.64001f,mp4a.40.2
    Video range: SDR
Using Stream 1
Downloading to '6755 - Auga Seca - Ep 1 - Auga Seca.mp4'...
Fething data for episode 2 of 6...
Found 1 streams
  Stream 1:
    Bandwidth: 2.01 Mbps
    Resolution: 1920x1080
    Frame rate: 25.000
    Codecs: avc1.64001f,mp4a.40.2
    Video range: SDR
Defaulting to first stream
Downloading to '6755 - Auga Seca - Ep 2 - Auga Seca.mp4'...
Fething data for episode 3 of 6...
Found 1 streams
  Stream 1:
    Bandwidth: 2.01 Mbps
    Resolution: 1920x1080
    Frame rate: 25.000
    Codecs: avc1.64001f,mp4a.40.2
    Video range: SDR
Defaulting to first stream
Downloading to '6755 - Auga Seca - Ep 3 - Auga Seca.mp4'...
Fething data for episode 4 of 6...
Found 1 streams
  Stream 1:
    Bandwidth: 2.01 Mbps
    Resolution: 1920x1080
    Frame rate: 25.000
    Codecs: avc1.64001f,mp4a.40.2
    Video range: SDR
Defaulting to first stream
Downloading to '6755 - Auga Seca - Ep 4 - Auga Seca.mp4'...
Fething data for episode 5 of 6...
Found 1 streams
  Stream 1:
    Bandwidth: 2.01 Mbps
    Resolution: 1920x1080
    Frame rate: 25.000
    Codecs: avc1.64001f,mp4a.40.2
    Video range: SDR
Defaulting to first stream
Downloading to '6755 - Auga Seca - Ep 5 - Auga Seca.mp4'...
Fething data for episode 6 of 6...
Found 1 streams
  Stream 1:
    Bandwidth: 2.01 Mbps
    Resolution: 1920x1080
    Frame rate: 25.000
    Codecs: avc1.64001f,mp4a.40.2
    Video range: SDR
Defaulting to first stream
Downloading to '6755 - Auga Seca - Ep 6 - Auga Seca.mp4'...
Successfully downloaded '6755 - Auga Seca - Ep 1 - Auga Seca.mp4'
Successfully downloaded '6755 - Auga Seca - Ep 2 - Auga Seca.mp4'
Successfully downloaded '6755 - Auga Seca - Ep 5 - Auga Seca.mp4'
Successfully downloaded '6755 - Auga Seca - Ep 3 - Auga Seca.mp4'
Successfully downloaded '6755 - Auga Seca - Ep 6 - Auga Seca.mp4'
Successfully downloaded '6755 - Auga Seca - Ep 4 - Auga Seca.mp4'
```

Downloading live media from RTP1:
```
$ rtp-dl -u https://www.rtp.pt/play/direto/rtp1 -f mp4 -o out
Fething data for live channel rtp1...
Channel ID: 5
Channel Name: RTP1
Currently playing: Telejornal
Next playing: The Voice Portugal - Especial 10 Anos
Found 3 streams
  Stream 1:
    Bandwidth: 2.42 Mbps
  Stream 2:
    Bandwidth: 1.23 Mbps
  Stream 3:
    Bandwidth: 625.00 kbps
Using Stream 1
Downloading to '/home/user/out/c5/RTP1 - 1642971662.mp4'...
Press Ctrl + C to stop downloading
Added 20 fragments, 80000 ms duration, new max 573445
Added 5 fragments, 20000 ms duration, new max 573450
Added 5 fragments, 20000 ms duration, new max 573455
Added 6 fragments, 24000 ms duration, new max 573461
^CGot SIGINT, stopping fragment updates
Please wait for the list of fragments to drain
Fragment queue drained, stopping transcode/transmux
Transmuxing/transcoding process finished (255)
```