#!/bin/sh

DEB_PACKAGE_NAME=$(node -e "console.log(require('./package.json').name)")
DEB_PACKAGE_DESCRIPTION=$(node -e "console.log(require('./package.json').description)")
DEB_PACKAGE_VERSION=$(node -e "console.log(require('./package.json').version.split('.').join('-').replace('-', '.'))")
DEB_PACKAGE_ARCHITECTURE="amd64"
DEB_PACKAGE_MAINTAINER=$(node -e "console.log(require('./package.json').author)")

BIN_NAME=$(node -e "console.log(Object.keys(require('./package.json').bin)[0])")
BIN_PATH=./$(node -e "console.log(require('./package.json').pkg.outputPath)")/${BIN_NAME}-linux

DEB_NAME=${DEB_PACKAGE_NAME}_${DEB_PACKAGE_VERSION}_${DEB_PACKAGE_ARCHITECTURE}
DEB_ROOT=./${DEB_NAME}

chmod +x ./assets/bin/ffmpeg/*

pkg .

mkdir -p ${DEB_ROOT}/DEBIAN
echo "Package: $DEB_PACKAGE_NAME" > ${DEB_ROOT}/DEBIAN/control
echo "Version: $DEB_PACKAGE_VERSION" >> ${DEB_ROOT}/DEBIAN/control
echo "Architecture: $DEB_PACKAGE_ARCHITECTURE" >> ${DEB_ROOT}/DEBIAN/control
echo "Maintainer: $DEB_PACKAGE_MAINTAINER" >> ${DEB_ROOT}/DEBIAN/control
echo "Description: $DEB_PACKAGE_DESCRIPTION" >> ${DEB_ROOT}/DEBIAN/control

mkdir -p ${DEB_ROOT}/usr/local/bin
cp ${BIN_PATH} ${DEB_ROOT}/usr/local/bin/${BIN_NAME}

dpkg-deb --build --root-owner-group ${DEB_NAME}

rm -rf ${DEB_ROOT}
