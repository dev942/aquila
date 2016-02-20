
aq.page.client = {

'needKeys' : false,

'init' : function() {
    var mc = aq.getStorage('marketControl').msg;
    if(!mc.clientUri.match(/^(http|https):\/\//)) return;

    $('#client-me').text(conf.version);
    $('#client-version').text(mc.clientVersion.join(', '));
    // Can't use download attribute if it's not same-origin
    var a = $('<a/>', {
        'text' : mc.clientUri,
        'href' : mc.clientUri,
    });
    a.appendTo('#client-url');
    $('#client-hash').text(mc.clientHash);
},

};

