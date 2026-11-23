#!/usr/bin/env bash
# Descarcă validatorul oficial KoSIT + configurația XRechnung (o singură dată) și validează fișierele date.
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)/kosit"
if [ ! -f "$D/config/scenarios.xml" ]; then
  mkdir -p "$D" && cd "$D"
  curl -sSfL -o v.zip https://github.com/itplr-kosit/validator/releases/download/v1.5.0/validator-1.5.0-distribution.zip
  curl -sSfL -o c.zip https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/release-2025-07-10/validator-configuration-xrechnung_3.0.2_2025-07-10.zip
  unzip -qo v.zip -d validator && unzip -qo c.zip -d config
fi
java -jar "$D/validator/validationtool-1.5.0-standalone.jar" -s "$D/config/scenarios.xml" -r "$D/config" -o "$D/reports" "$@"
