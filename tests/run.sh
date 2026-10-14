#!/bin/sh
# Run the Just Type UI tests in headless Chromium.
#
# Usage: tests/run.sh <enyo-framework-dir>
#
# <enyo-framework-dir> is the Enyo 1.0 framework the device ships, i.e. a
# copy of /usr/palm/frameworks/enyo/0.10/framework, for example:
#   ssh -p 5522 root@localhost 'tar -C /usr/palm/frameworks -cf - enyo/0.10' | tar -xf - -C <dir>
#
# Exit code is the number of failed tests (plus one per uncaught JS error).
set -u
FW=$(cd "${1:?usage: $0 <enyo-framework-dir>}" && pwd)
DIR=$(cd "$(dirname "$0")" && pwd)
CHROMIUM=${CHROMIUM:-chromium}

out=$("$CHROMIUM" --headless --no-sandbox --disable-gpu --allow-file-access-from-files \
	--virtual-time-budget=120000 --dump-dom \
	"file://$DIR/index.html?fw=file://$FW" 2>/dev/null |
	sed -n '/@@RESULTS@@/,/@@END@@/p' | sed '1d;$d' |
	sed 's/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/&amp;/\&/g')

if [ -z "$out" ]; then
	echo "no test results: the page did not finish (load error?)" >&2
	exit 99
fi
echo "$out"
fails=$(echo "$out" | grep -c '^FAIL ')
jserr=$(echo "$out" | grep -c '^JS ERROR ')
exit $((fails + jserr))
