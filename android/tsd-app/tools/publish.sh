#!/usr/bin/env bash
#
# Sherset TSD — yangi versiyani chiqarish (build → server → manifest).
#
# Terminal ilovani `latest.json` orqali topadi (`Updater.kt`), shuning uchun
# APK va manifest DOIM BIRGA yangilanadi: manifest yangi, APK eski bo'lsa
# omborchining terminali 404 oladi va yangilanish yiqiladi.
#
# 🔴 IMZO. Yangilanish faqat AYNI kalit bilan imzolangan APK ustiga tushadi.
# Hozir debug-kalit ishlatiladi (`~/.android/debug.keystore`, 2056 gacha) —
# ya'ni build DOIM SHU MASHINADA qilinishi kerak. Kalit yo'qolsa har terminalda
# ilovani o'chirib qayta o'rnatish kerak bo'ladi VA JUFTLASH YO'QOLADI.
#
# Ishlatish:
#   bash android/tsd-app/tools/publish.sh "nima o'zgardi"
#
# Oldindan: `app/build.gradle.kts` da `versionCode` +1 va `versionName`
# oshirilgan bo'lsin (skript ularni o'zi o'qiydi).

set -euo pipefail

NOTES="${1:-}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRADLE="${GRADLE_BIN:-/d/dev/_downloads/g87/gradle-8.7/bin/gradle}"
JAVA="${JAVA_HOME_17:-/d/dev/java/jdk-17}"
SDK="${ANDROID_SDK:-/d/dev/android-sdk}"
SSH_KEY="${SHERSET_KEY:-$HOME/.ssh/sherset_key}"
HOST="${SHERSET_HOST:-root@13.140.157.10}"
REMOTE_DIR="/var/www/kassa-downloads/tsd"
BASE_URL="https://erp.sherset.uz/downloads/tsd"

# `grep -oP` ATAYLAB ishlatilmaydi: Git Bash (Windows) da PCRE faqat unibyte/
# UTF-8 lokalda ishlaydi va skript «grep: -P supports only…» bilan yiqilardi.
VERSION_CODE=$(sed -n 's/.*versionCode[[:space:]]*=[[:space:]]*\([0-9]\{1,\}\).*/\1/p' \
  "$APP_DIR/app/build.gradle.kts" | head -1)
VERSION_NAME=$(sed -n 's/.*versionName[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$APP_DIR/app/build.gradle.kts" | head -1)
[ -n "$VERSION_CODE" ] && [ -n "$VERSION_NAME" ] || { echo "versionCode/Name o'qilmadi"; exit 1; }
APK_NAME="sherset-tsd-${VERSION_NAME}.apk"

echo "→ $VERSION_NAME (code $VERSION_CODE)"

# Shu versiya allaqachon chiqarilganmi — jimgina ustiga yozish, o'rnatilgan
# terminallarda «yangilandim» degan yolg'on holatga olib kelardi.
if curl -sfI --max-time 20 "$BASE_URL/$APK_NAME" >/dev/null 2>&1; then
  echo "🔴 $APK_NAME serverda ALLAQACHON bor — versiyani oshiring." >&2
  exit 1
fi

echo "→ build"
( cd "$APP_DIR" && JAVA_HOME="$JAVA" ANDROID_HOME="$SDK" "$GRADLE" --no-daemon assembleDebug )

APK="$APP_DIR/app/build/outputs/apk/debug/app-debug.apk"
SHA=$(sha256sum "$APK" | cut -d' ' -f1)
echo "→ sha256 $SHA"

TMP_JSON="$(mktemp)"
cat > "$TMP_JSON" <<EOF
{
  "versionCode": $VERSION_CODE,
  "versionName": "$VERSION_NAME",
  "url": "$BASE_URL/$APK_NAME",
  "sha256": "$SHA",
  "notes": "$NOTES"
}
EOF

# TARTIB MUHIM: avval APK, keyin manifest. Teskarisida manifest yangi APK'ni
# ko'rsatib turardi-yu, fayl hali yo'q edi.
echo "→ APK yuklanmoqda"
scp -i "$SSH_KEY" -o BatchMode=yes "$APK" "$HOST:$REMOTE_DIR/$APK_NAME"
echo "→ manifest yuklanmoqda"
scp -i "$SSH_KEY" -o BatchMode=yes "$TMP_JSON" "$HOST:$REMOTE_DIR/latest.json"
rm -f "$TMP_JSON"

echo "→ tekshiruv"
curl -sfI --max-time 20 "$BASE_URL/$APK_NAME" >/dev/null || { echo "APK ochilmadi"; exit 1; }
REMOTE_SHA=$(curl -sf --max-time 20 "$BASE_URL/latest.json" |
  sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ "$REMOTE_SHA" = "$SHA" ] || { echo "manifest xeshi mos emas"; exit 1; }

echo "✅ $VERSION_NAME chiqarildi — terminallar keyingi ochilishda ko'radi"
