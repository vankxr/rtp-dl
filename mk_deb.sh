#!/bin/sh

VERSION="1.0-2"

chmod +x ./assets/bin/ffmpeg/*

pkg .

mkdir -p ./rtp-dl_${VERSION}_amd64/DEBIAN
cp ./.deb/control ./rtp-dl_${VERSION}_amd64/DEBIAN

mkdir -p ./rtp-dl_${VERSION}_amd64/usr/local/bin
cp ./dist/rtp-dl-linux ./rtp-dl_${VERSION}_amd64/usr/local/bin/rtp-dl

dpkg-deb --build --root-owner-group rtp-dl_${VERSION}_amd64

rm -rf ./rtp-dl_${VERSION}_amd64
