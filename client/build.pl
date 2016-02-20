
mkdir 'build';
system 'rm build/*';

$version = 'unknown';
$network = 'unknown';

@ARGV = ('main.html');
for(<>) {
    if(m#^<script src="(.+)"></script>$#) {
        push(@js, `cat $1`);
    } elsif(m#^<link rel="stylesheet" href="(.+)">$#) {
        push(@css, `cat $1`);
    } else {
        $html .= $_;
    }
}
for(@js) {
    if(m#^\s*'version'\s*:\s*'(.*)'#) { $version = $1; }
    if(m#^\s*'network'\s*:\s*'(.*)'#) { $network = $1; }
}
open(JS, ">build/aquila.js") or die $!;
print JS join("", @js);
close JS;
open(CSS, ">build/aquila.css") or die $!;
print CSS join("", @css);
close CSS;
open(HTML, ">build/aquila.html") or die $!;
print HTML $html;
close HTML;
system "cat build/aquila.css | minify --css > build/aquila.min.css";
# minify --js causes the code to break, investigate later
system "cat build/aquila.js | uglifyjs > build/aquila.min.js";
system "cat build/aquila.html | minify --html > build/aquila.min.html";

$js = join('', `cat build/aquila.min.js`);
$css = join('', `cat build/aquila.min.css`);
$html = join('', `cat build/aquila.min.html`);
$netHtml = $html;

$t = time;

$p = <<EOT;

<!-- Aquila Market Client - one file, for running locally              -->

<!-- Save this file somewhere convenient, for example on your desktop, -->
<!-- and open it in a browser. JavaScript must be enabled, but only    -->
<!-- for that one file:// URL. By saving the client locally, you take  -->
<!-- the risk that whoever gave you this file is malicious only once,  -->
<!-- instead of every time you run it.                                 -->

<!-- version=$version network=$network t=$t -->

EOT

$html =~ s#<body>#<script>$js</script><style>$css</style>$&#s;
$html =~ s#<!DOCTYPE html>#$&$p#s;

open(HTML, ">build/aquila-standalone-safe.html") or die $!;
print HTML $html;
close HTML;

$p = <<EOT;

<!-- Aquila Market Client - separate HTML, CSS, JS, for running live   -->

<!-- This version of the client is designed to run without             -->
<!-- installation. This is safe only if you trust whatever server you  -->
<!-- are loading it from. It's better to install the client locally,   -->
<!-- by following the instructions in aquila-standalone-safe.html.     -->

<!-- version=$version network=$network t=$t -->

EOT

$netHtml =~ s#<body>#<script src="aquila.min.js"></script><link rel="stylesheet" href="aquila.min.css">$&#s;
$netHtml =~ s#<!DOCTYPE html>#$&$p#s;

system 'rm build/aquila.html build/aquila.css build/aquila.js build/aquila.min.html';

open(HTML, ">build/aquila-live-dangerous.html") or die $!;
print HTML $netHtml;
close HTML;


