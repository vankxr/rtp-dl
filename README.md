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
  -s, --stream <stream>         Use this stream if multiple streams exist
  -S, --list-streams            List available streams
  -d, --debug                   Print debugging information
  -h, --help                    Display this help information
```

## Example
Downloading a season of a TV Series:
```
$ rtp-dl -u https://www.rtp.pt/play/p6755/auga-seca
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
Defaulting to first stream
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

Downloading live media from RTP3:
```
$ rtp-dl -u  https://www.rtp.pt/play/direto/rtp3
Fething data for live channel rtp3...
Channel ID: 64
Channel Name: RTP3
Currently playing: Visita Guiada
Next playing: Todas as Palavras
Found 3 streams
  Stream 1:
    Bandwidth: 2.42 Mbps
  Stream 2:
    Bandwidth: 1.23 Mbps
  Stream 3:
    Bandwidth: 625.00 kbps
Defaulting to first stream
Downloading to '64 - RTP3.mp4'...
Press Ctrl + C to stop downloading
Added 20 fragments, 120000 ms duration, new max 280613
Added 8 fragments, 48000 ms duration, new max 280621
Added 7 fragments, 42000 ms duration, new max 280628
Added 5 fragments, 30000 ms duration, new max 280633
Added 6 fragments, 36000 ms duration, new max 280639
Added 6 fragments, 36000 ms duration, new max 280645
^CGot SIGINT, stopping fragment updates
Please wait for the list of fragments to drain
```