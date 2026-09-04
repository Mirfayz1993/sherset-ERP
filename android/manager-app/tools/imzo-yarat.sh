#!/usr/bin/env bash
#
# Sherset (menejer/xodim ilovasi) — release-kalitni BIR MARTA yaratish (X-reja X7).
#
# 🔴 BU SKRIPT KALITNI QAYTA YARATMAYDI. Yo'qolgan kalit o'rniga YANGI kalit
# yaratilsa u BOSHQA kalit bo'ladi: planshetlardagi/telefonlardagi ilova ustiga
# yangilanish TUSHMAYDI (Android imzoni solishtiradi) va har qurilmada ilova
# o'chirilib qayta o'rnatiladi — ya'ni har xodim QAYTA LOGIN qiladi. Shuning
# uchun kalit mavjud bo'lsa skript TO'XTAYDI. Yagona to'g'ri «tiklash» —
# zaxiradan NUSXA olish (README «Release imzo» bo'limi).
#
# Kalit ham, parol ham REPODAN TASHQARIDA turadi (repo public):
#   $HOME/.sherset/sherset-manager-release.jks         — kalit
#   $HOME/.sherset/sherset-manager-release.properties  — parol + alias (chmod 600)
# Gradle o'sha `.properties` ni o'qiydi (`app/build.gradle.kts`).
#
# 🔴 TSD KALITI QAYTA ISHLATILMAYDI. `sherset-tsd-release.jks` boshqa ilovaniki
# (`uz.sherset.tsd`); ikkalasini bitta kalitga bog'lash bitta yo'qotish bilan
# IKKI kanalni birdaniga o'ldirardi.
#
# Ishlatish (bir marta, shu mashinada):
#   bash android/manager-app/tools/imzo-yarat.sh

set -euo pipefail

JAVA="${JAVA_HOME_17:-/d/dev/java/jdk-17}"
KEY_DIR="${SHERSET_KEY_DIR:-$HOME/.sherset}"
KEYSTORE="$KEY_DIR/sherset-manager-release.jks"
PROPS="$KEY_DIR/sherset-manager-release.properties"
ALIAS="${SHERSET_KEY_ALIAS:-sherset-manager}"
# 30 yil (2056 gacha) — tsd-app bilan bir xil ufq. Muddat tugasa ESKI imzoli
# ilovalar ishlayveradi, lekin YANGI chiqarish uchun kalit kerak.
VALIDITY_DAYS=10950

[ -x "$JAVA/bin/keytool.exe" ] || [ -x "$JAVA/bin/keytool" ] || {
  echo "🔴 keytool topilmadi: $JAVA/bin/keytool — JAVA_HOME_17 ni bering" >&2; exit 1; }
KEYTOOL="$JAVA/bin/keytool"

# Kalit repo ichida tug'ilib qolmasin (bir marta xato qilinsa public repoga
# ketadi va ortga qaytarib bo'lmaydi — tarixda qoladi).
case "$KEY_DIR" in
  */sherset-v2/*|*/sherset-v2) echo "🔴 kalit repo ICHIDA bo'lmaydi: $KEY_DIR" >&2; exit 1;;
esac

if [ -e "$KEYSTORE" ]; then
  echo "🔴 Kalit ALLAQACHON bor: $KEYSTORE"
  echo "   Ustiga yozilmaydi. Boshqa mashinada ishlayotgan bo'lsangiz —"
  echo "   zaxiradan nusxa oling (README «Release imzo»), yangisini YARATMANG."
  exit 1
fi

mkdir -p "$KEY_DIR"
# 48 belgili hex — properties faylida qochirish (escaping) talab qilmaydi va
# odam terib kiritmaydi (fayldan o'qiladi).
PASS="$(openssl rand -hex 24)"

echo "→ kalit yaratilmoqda ($ALIAS, RSA 4096, $VALIDITY_DAYS kun)"
"$KEYTOOL" -genkeypair \
  -keystore "$KEYSTORE" -storetype PKCS12 \
  -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity "$VALIDITY_DAYS" \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=Sherset, OU=Menejment, O=Sherset, L=Tashkent, C=UZ" >/dev/null

# Gradle Windows'da ishlaydi ⇒ properties'ga WINDOWS yo'li yoziladi
# (`/c/Users/...` ni Gradle topolmaydi). Oldinga qiya chiziq `.properties`
# da qochirish talab qilmaydi.
STORE_WIN="$(cygpath -m "$KEYSTORE" 2>/dev/null || echo "$KEYSTORE")"

umask 077
cat > "$PROPS" <<EOF
# Sherset menejer/xodim ilovasi — release-imzo. 🔴 SIR. Repoga TUSHMAYDI,
# chatga/xabarga ko'chirilmaydi. Zaxira tartibi: android/manager-app/README.md
storeFile=$STORE_WIN
storePassword=$PASS
keyAlias=$ALIAS
keyPassword=$PASS
EOF
chmod 600 "$PROPS" "$KEYSTORE" 2>/dev/null || true
unset PASS

echo "✅ yaratildi:"
echo "   kalit  : $KEYSTORE"
echo "   parol  : $PROPS (chmod 600)"
echo
echo "→ sertifikat izi (SIR EMAS — publish.sh shuni tekshiradi):"
"$KEYTOOL" -list -v -keystore "$KEYSTORE" -alias "$ALIAS" \
  -storepass "$(sed -n 's/^storePassword=//p' "$PROPS")" |
  sed -n '/SHA256:/p;/Valid from/p'
echo
echo "🔴 KEYINGI IKKI QADAM:"
echo "   1) Yuqoridagi SHA-256 izini (nuqtasiz, kichik harfda) "
echo "      android/manager-app/tools/publish.sh dagi EXPECTED_SIGNER ga yozing."
echo "      Bo'sh qolsa publish.sh ATAYLAB to'xtaydi — imzosiz APK chiqib ketmasin."
echo "   2) ZAXIRA: ikkala faylni ham repodan TASHQARI ikkita joyga nusxalang"
echo "      (README «Release imzo» → «Zaxira»). Kalitsiz yangilanish kanali o'ladi."
