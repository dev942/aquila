

aq.page.uploadImgs = {

'needKeys' : true,

'init' : function() {
    var keys = aq.getStorage('keys');

    var have = { };
    function gotOne(r) {
        if(!(isObj(r) && isObj(r.result) && isArray(r.result.thumbs))) return;

        r.result.thumbs.forEach(function(thumb) {
            if(have[thumb.hash]) return;

            var div = $('<div/>'), label = $('<label/>');
            $('<img/>', {
                'src' : 'data:' + aq.imageDataUrl(thumb.thumb)
            }).appendTo(label);
            var radio = $('<input/>', { 'type' : 'radio',
                                        'name' : 'uploadImgs-del' });
            radio.appendTo(label);
            label.appendTo(div);
            div.appendTo('#uploadImgs-existing');

            have[thumb.hash] = radio;
        });
        if(Object.keys(have).length === 0) {
            $('#uploadImgs-existing').text(
                '\u2003(no images have been uploaded yet)');
            $('#uploadImgs-delete').css('display', 'none');
        } else {
            $('#uploadImgs-delete').css('display', 'inline');
        }
        ui.hidePopup('log');
    }

    $('#uploadImgs-delete').on('click', function() {
        var hash;
        for(hash in have) {
            if(have[hash][0].checked) {
                var dm = {
                    'type'      : 'deleteMessage',
                    'toDelete'  : hash,
                    'comment'   : 'by poster from client',
                };
                aq.finishAndSendMsg(dm, function() { ui.navReload(); });
                return;
            }
        }
        ui.showPopup('notify', 'No image to delete selected.');
    });

    aq.rpc.toServers('searchMsg', {
        'type'      : 'image',
        'sigFrom'   : [ keys.primary ],
        'resultsAs' : 'thumb',
    }, gotOne, null);
    ui.showPopup('log');
},

'previewFinish' : function(blob) {
    createImageBitmap(blob).then(function(img) {
        function scaleToCanvas(img, dest, scale) {
            var w = scale*img.width, h = scale*img.height;

            var ci = $(dest)[0], cic = ci.getContext('2d');
            ci.height = h;
            ci.width = w;
            cic.drawImage(img, 0, 0, w, h);
        }

        var whMax = Math.max(img.width, img.height),
            scaleImage = Math.min(1, 330/whMax),
            scaleThumb = 110/whMax;

        scaleToCanvas(img, '#uploadImgs-image', scaleImage);
        scaleToCanvas(img, '#uploadImgs-thumb', scaleThumb);
        $('#uploadImgs-preview').css('display', 'block');
        $('#uploadImgs-upload').css('display', 'inline');
    });
},

'preview' : function() {
    var input = $(document.createElement('input'));
    input.attr('type', 'file');
    input.attr('accept', '.jpeg,.jpg');
    input.on('change', function(e) {
        var fl = input[0].files;
        if(fl.length !== 1) return;
        aq.page.uploadImgs.previewFinish(fl[0]);
    });
    input.trigger('click');
},

'upload' : function() {
    function getDatUrl(id, maxLen) {
        var c = $(id)[0], quality = 0.8;
        for(;;) {
            var url = c.toDataURL('image/jpeg', quality);
            if(url.length < maxLen) {
                return url;
            } else if(quality > 0.1) {
                quality -= 0.1;
            } else {
                alert('Could not export JPEG within size limit.');
                return;
            }
        }
    }

    var image = getDatUrl('#uploadImgs-image', 90*1000),
        thumb = getDatUrl('#uploadImgs-thumb', 9*1000);
    var m = {
        'type'  : 'image',
        'image' : image,
        'thumb' : thumb,
    };
    aq.finishAndSendMsg(m, function() { ui.navReload(); });
},

};
