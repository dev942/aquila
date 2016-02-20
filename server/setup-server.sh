apt-get -y install make

apt-get -y install mongodb

apt-get -y install nodejs-legacy
apt-get -y install npm

apt-get -y install libcairo2-dev libjpeg8-dev libpango1.0-dev libgif-dev build-essential g++

# in this directory, local install
npm install mongodb
npm install node-json-rpc
npm install async
npm install canvas
npm install node-captcha
npm install bitcoinjs-lib
npm install socks5-http-client
npm install socks5-https-client
npm install secp256k1


# for the client only

pushd node_modules/bitcoinjs-lib/
npm install aes
popd

apt-get -y install node-uglify
npm install -g browserify
pushd node_modules/bitcoinjs-lib/
browserify -r bitcoinjs-lib -r ecurve -r bigi -r buffer -r randombytes -r aes| \
    uglifyjs > ../../../client/lib/lib.min.js
popd
npm install -g minify

