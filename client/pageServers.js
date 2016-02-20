
aq.page.servers = {

'needKeys' : false,

'init' : function() {
    var inMc = { }, inBootstrap = { };
    var mc = aq.getStorage('marketControl');
    if(isObj(mc)) {
        mc = mc.msg;
        mc.serverUris.forEach(function(uri) { inMc[uri] = true; });
    }
    conf.serverUris.forEach(function(uri) { inBootstrap[uri] = true; });

    var uris, servers = aq.getStorage('servers');
    if(servers) {
        uris = Object.keys(servers);
        uris.sort(function(a, b) {
            return servers[b].goodness - servers[a].goodness;
        });
    } else {
        uris = [ ];
    }

    function yes(v) { return v ? '\u2713' : '' }

    uris.forEach(function(uri) {
        var tr = $('<tr/>');
        $('<td/>', { 'text' : uri, 'class' : 'mono' }).appendTo(tr);
        $('<td/>', { 'text' : servers[uri].goodness.toFixed(0) }).appendTo(tr);
        $('<td/>', { 'text' : servers[uri].dtAverage.toFixed(3) }).appendTo(tr);
        $('<td/>', { 'text' : timeAgo(servers[uri].receivedAt) }).appendTo(tr);
        $('<td/>', {
            'text'  : yes(inMc[uri]),
            'class' : 'center',
       }).appendTo(tr);
        $('<td/>', {
            'text'  : yes(inBootstrap[uri]),
            'class' : 'center',
        }).appendTo(tr);
        tr.appendTo('#servers-working');
    });

    for(var i = 0; i < 3; i++) {
        var sm = $('#servers-manual-' + i);
        sm[0].placeholder = 'http://xxx.onion';
        sm[0].value = '';
        sm.on('input', function() {
            $('#servers-manual')[0].checked = true;
        });
    }
    var serversForce = aq.getStorage('serversForce');
    if(serversForce) {
        $('#servers-manual')[0].checked = true;
        for(var i = 0; i < Math.min(3, serversForce.length); i++) {
            $('#servers-manual-' + i)[0].value = serversForce[i];
        }
    } else {
        $('#servers-auto')[0].checked = true;
    }
},

'save' : function() {
    var sf = [ ];
    if($('#servers-manual')[0].checked) {
        for(var i = 0; i < 3; i++) {
            var s = $('#servers-manual-' + i)[0].value;
            if(s.match(/^http/)) sf.push(s);
        }
    }
    aq.setStorage('serversForce', sf.length > 0 ? sf : null);
    ui.navReload();
},

};
