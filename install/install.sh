#!/bin/sh
# Odin NS Manager - installer for Linux.
#
# Debian, Ubuntu, Raspberry Pi OS (Raspbian), CentOS / RHEL / Rocky / Alma
# (8 or newer) and Alpine Linux. Written for a plain POSIX shell, so it runs
# with the ash of Alpine as well.
#
#   sudo sh install.sh                 a menu of what follows
#   sudo sh install.sh install         installs what is needed, asks the questions of the
#                                      configuration, and starts the service
#   sudo sh install.sh update          brings the service to the newest version
#   sudo sh install.sh configure       asks the questions of the configuration again
#   sudo sh install.sh uninstall       removes the service; asks before any data is removed
#   sudo sh install.sh status          the state of the service
#
# Options:
#   -y, --yes          do not ask: take the defaults, or the ODIN_* variables below
#   --branch NAME      the branch, tag or commit to install (default: master, or the installed one)
#   --source DIR       install from a folder that holds the project, instead of the repository
#   --purge            with uninstall: also remove the settings, certificates, logs and the database
#
# Without a terminal, or with --yes, the answers are taken from the environment:
#   ODIN_SERVER_NAME ODIN_COMPANY_NAME ODIN_NS_ADDRESS ODIN_NS_PORT ODIN_NS_UPSTREAM
#   ODIN_NS_DNSSEC (off|validate) ODIN_NS_QUERY_LOG_ENABLED (true|false) ODIN_HTTP_PORT
#   ODIN_HTTPS_DOMAINS ODIN_ACME_EMAIL ODIN_HTTPS_PORT   (HTTPS with Let's Encrypt, when domains are given)
#   ODIN_DB (local|docker|existing)  FREYA_DB_URI  FREYA_ADMIN_USER  FREYA_ADMIN_PWD
#
# What is installed where:
#   /opt/odin-ns-manager        the program (owned by root)
#   /etc/odin-ns-manager        odin.env: the key of the tokens, the database, the folders
#   /var/lib/odin-ns-manager    settings.json (what the Settings page saves) and the certificates
#   /var/log/odin-ns-manager    the logs
# The service runs as the user "odin", and is managed by systemd, or by OpenRC on Alpine.
set -eu

NAME=odin-ns-manager
REPO=${ODIN_REPO:-https://github.com/csabatibortoth/odin-ns-manager.git}
APP_DIR=${ODIN_APP_DIR:-/opt/$NAME}
ETC_DIR=${ODIN_ETC_DIR:-/etc/$NAME}
DATA_DIR=${ODIN_DATA_DIR:-/var/lib/$NAME}
LOG_DIR=${ODIN_LOG_DIR:-/var/log/$NAME}
ENV_FILE=$ETC_DIR/odin.env
STATE_FILE=$ETC_DIR/install.state
SETTINGS_FILE=$DATA_DIR/settings.json
SERVICE_USER=odin
MIN_NODE=22
NODE_MAJOR=${ODIN_NODE_MAJOR:-22}
MONGO_VERSION=${ODIN_MONGO_VERSION:-8.0}
# For the processors MongoDB 5 and newer do not run on: no AVX, or older than ARMv8.2 (Raspberry Pi 4)
MONGO_OLD_TAG=4.4.18
# Seconds to wait for the database and for the service to answer
WAIT=${ODIN_WAIT:-90}
CONTAINER=odin-mongo
VOLUME=odin-mongo-data
DB_NAME=odin-ns-manager
RESOLVED_DROPIN=/etc/systemd/resolved.conf.d/$NAME.conf
UNIT_FILE=/etc/systemd/system/$NAME.service
RC_FILE=/etc/init.d/$NAME

ASSUME_YES=0
PURGE=0
REF=
SOURCE_DIR=
COMMAND=

###--- Talking to the person who installs

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# The answers are read from the terminal, also when the script itself is piped in
open_terminal() {
    if [ -t 0 ] || [ -n "${ODIN_INSTALL_TEST:-}" ]; then exec 3<&0
    elif [ "$ASSUME_YES" = 0 ] && (exec 3</dev/tty) 2>/dev/null; then exec 3</dev/tty
    else ASSUME_YES=1; exec 3</dev/null
    fi
}

# ask VAR "Question" "default"
ask() {
    a_var=$1; a_answer=
    if [ "$ASSUME_YES" = 0 ]; then
        if [ -n "${3-}" ]; then printf '%s [%s]: ' "$2" "$3"; else printf '%s: ' "$2"; fi
        IFS= read -r a_answer <&3 || a_answer=
    fi
    [ -n "$a_answer" ] || a_answer=${3-}
    eval "$a_var=\$a_answer"
}

# ask_secret VAR "Question" - what is typed is not shown
ask_secret() {
    s_var=$1; s_answer=
    if [ "$ASSUME_YES" = 0 ]; then
        printf '%s: ' "$2"
        stty -echo <&3 2>/dev/null || true
        IFS= read -r s_answer <&3 || s_answer=
        stty echo <&3 2>/dev/null || true
        printf '\n'
    fi
    eval "$s_var=\$s_answer"
}

# ask_yes "Question" y|n - true for yes
ask_yes() {
    while :; do
        if [ "$2" = y ]; then ask y_answer "$1 (Y/n)" ""; else ask y_answer "$1 (y/N)" ""; fi
        case ${y_answer:-$2} in
            y|Y|yes|Yes|YES) return 0 ;;
            n|N|no|No|NO) return 1 ;;
        esac
    done
}

# choose VAR "Question" key "Label" key "Label" ... - the first one is the default
choose() {
    c_var=$1; c_count=0; c_keys=
    say "$2"; shift 2
    while [ $# -gt 0 ]; do
        c_count=$((c_count + 1)); c_keys="$c_keys $1"
        printf '  %s) %s\n' "$c_count" "$2"; shift 2
    done
    while :; do
        ask c_pick "Choose" 1
        case $c_pick in
            ''|*[!0-9]*) ;;
            *) if [ "$c_pick" -ge 1 ] && [ "$c_pick" -le "$c_count" ]; then break; fi ;;
        esac
    done
    # shellcheck disable=SC2086
    set -- $c_keys
    eval "c_key=\${$c_pick}"
    eval "$c_var=\$c_key"
}

###--- Small tools

# Files of NAME=value lines: the environment of the service, and the notes of this installer
kv_get() { if [ -f "$1" ]; then sed -n "s/^$2=//p" "$1" | tail -n 1; fi; }
kv_del() {
    [ -f "$1" ] || return 0
    grep -v "^$2=" "$1" > "$1.tmp" || true
    cat "$1.tmp" > "$1"; rm -f "$1.tmp"
}
kv_set() {
    [ -f "$1" ] || : > "$1"
    kv_del "$1" "$2"
    printf '%s=%s\n' "$2" "$3" >> "$1"
}
state_get() { kv_get "$STATE_FILE" "$1"; }
state_set() { kv_set "$STATE_FILE" "$1" "$2"; }

random_hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
mask_uri() { printf '%s' "$1" | sed 's#//[^@/]*@#//***@#'; }
is_root() { [ "$(id -u)" = 0 ]; }
own() { if is_root; then chown "$@"; fi; }

# Only what this installer made is ever removed: a path of its own, never a short or an empty one
remove_dir() {
    case $1 in
        */"$NAME"|*/"$NAME"/*) rm -rf "$1" ;;
        *) warn "Not removed, as it is not a folder of $NAME: $1" ;;
    esac
}

# wait_port HOST PORT SECONDS - true as soon as the port answers; 0 seconds: one try
wait_port() {
    node -e '
        const [host, port, seconds] = process.argv.slice(1);
        const until = Date.now() + seconds * 1000;
        (function attempt() {
            const socket = require("net").connect({ host, port: Number(port), timeout: 2000 });
            const again = () => { socket.destroy(); Date.now() >= until ? process.exit(1) : setTimeout(attempt, 1000); };
            socket.once("connect", () => process.exit(0)).once("error", again).once("timeout", again);
        })();' "$1" "$2" "$3"
}

primary_address() {
    p_address=
    if have ip; then p_address=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1); fi
    printf '%s' "${p_address:-$(hostname)}"
}

###--- The system

detect_system() {
    OS_RELEASE=${ODIN_OS_RELEASE:-/etc/os-release}
    [ -r "$OS_RELEASE" ] || die "This system is not recognised: $OS_RELEASE is missing."
    # shellcheck disable=SC1090
    . "$OS_RELEASE"
    OS_ID=${ID:-unknown}
    OS_LIKE=${ID_LIKE:-}
    OS_VERSION=${VERSION_ID:-}
    OS_CODENAME=${VERSION_CODENAME:-}
    ARCH=$(uname -m)

    case " $OS_ID $OS_LIKE " in
        *" alpine "*) FAMILY=alpine ;;
        *" debian "*|*" ubuntu "*|*" raspbian "*) FAMILY=debian ;;
        *" rhel "*|*" centos "*|*" fedora "*) FAMILY=rhel ;;
        *) die "This distribution is not supported: ${PRETTY_NAME:-$OS_ID}. Supported: Debian, Ubuntu, Raspberry Pi OS, CentOS/RHEL and Alpine." ;;
    esac

    if [ "$FAMILY" = rhel ]; then
        [ "${OS_VERSION%%.*}" -ge 8 ] 2>/dev/null || die "${PRETTY_NAME:-$OS_ID} is too old: version 8 or newer is needed, for Node.js $MIN_NODE."
        if have dnf; then DNF=dnf; else DNF=yum; fi
    fi

    RASPBERRY=0
    if [ "$OS_ID" = raspbian ] || [ -f /etc/rpi-issue ]; then RASPBERRY=1; fi

    if [ -d /run/systemd/system ]; then INIT=systemd
    elif have rc-service; then INIT=openrc
    else INIT=none
    fi
}

APT_UPDATED=0
pkg() {
    case $FAMILY in
        debian)
            if [ "$APT_UPDATED" = 0 ]; then apt-get update -qq; APT_UPDATED=1; fi
            DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null ;;
        rhel) "$DNF" install -y -q "$@" >/dev/null ;;
        alpine) apk add --quiet "$@" ;;
    esac
}

# need COMMAND [PACKAGE] - installs the package when the command is missing
need() { have "$1" || { say "Installing ${2:-$1} ..."; pkg "${2:-$1}"; }; }

install_tools() {
    step "Tools"
    need curl
    need git
    need tar
    case $FAMILY in
        debian) pkg ca-certificates; need gpg gnupg ;;
        rhel) pkg ca-certificates ;;
        alpine) pkg ca-certificates ;;
    esac
    say "curl, git and the certificates of the certificate authorities are there."
}

###--- Node.js

node_ok() { have node && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge "$MIN_NODE" ]; }

# The build of nodejs.org, for the 32-bit ARM systems the package sources have nothing for
install_node_tarball() {
    need xz xz-utils
    n_base=https://nodejs.org/dist/latest-v$NODE_MAJOR.x
    n_file=$(curl -fsSL "$n_base/SHASUMS256.txt" | sed -n "s/.*\(node-v[0-9.]*-linux-$1\.tar\.xz\)\$/\1/p" | head -n 1)
    [ -n "$n_file" ] || die "nodejs.org has no build of Node.js $NODE_MAJOR for $1."
    n_tmp=$(mktemp -d)
    curl -fsSL -o "$n_tmp/$n_file" "$n_base/$n_file"
    (cd "$n_tmp" && curl -fsSL "$n_base/SHASUMS256.txt" | grep " $n_file\$" | sha256sum -c - >/dev/null) || die "The download of $n_file is damaged."
    rm -rf /usr/local/lib/nodejs
    mkdir -p /usr/local/lib/nodejs
    tar -xJf "$n_tmp/$n_file" -C /usr/local/lib/nodejs --strip-components=1
    rm -rf "$n_tmp"
    for n_bin in node npm npx; do ln -sf "/usr/local/lib/nodejs/bin/$n_bin" "/usr/local/bin/$n_bin"; done
}

install_node() {
    step "Node.js"
    if node_ok; then say "Node.js $(node --version) is installed."; return; fi
    have node && say "Node.js $(node --version) is too old: $MIN_NODE or newer is needed."

    say "Installing Node.js $NODE_MAJOR ..."
    case $FAMILY in
        alpine)
            pkg nodejs npm
            node_ok || die "This release of Alpine has no Node.js $MIN_NODE: Alpine 3.21 or newer is needed." ;;
        debian)
            case $ARCH in
                armv7l) install_node_tarball armv7l ;;
                armv6l) die "Node.js $MIN_NODE does not run on ARMv6 (Raspberry Pi 1 and Zero)." ;;
                *) need bash; curl -fsSL "https://deb.nodesource.com/setup_$NODE_MAJOR.x" | bash - >/dev/null; APT_UPDATED=1; pkg nodejs ;;
            esac ;;
        rhel)
            need bash; curl -fsSL "https://rpm.nodesource.com/setup_$NODE_MAJOR.x" | bash - >/dev/null; pkg nodejs ;;
    esac
    node_ok || die "Node.js $MIN_NODE or newer could not be installed."
    state_set NODE_INSTALLED 1
    say "Node.js $(node --version) is installed."
}

###--- The program

fetch_app() {
    step "Odin NS Manager"
    if [ -n "$SOURCE_DIR" ]; then
        [ -f "$SOURCE_DIR/server.js" ] || die "$SOURCE_DIR does not hold the project: server.js is missing."
        say "Copying the program from $SOURCE_DIR ..."
        mkdir -p "$APP_DIR"
        (cd "$SOURCE_DIR" && tar -cf - --exclude=./.git --exclude=./config/settings.json --exclude=./sslcert .) | (cd "$APP_DIR" && tar -xf -)
        state_set SOURCE "$SOURCE_DIR"
    else
        [ -n "$REF" ] || REF=$(state_get REF)
        [ -n "$REF" ] || REF=master
        if [ -d "$APP_DIR/.git" ]; then
            say "Fetching the newest of $REF ..."
            git -C "$APP_DIR" fetch --quiet --tags --force origin
        else
            [ ! -e "$APP_DIR" ] || [ -z "$(ls -A "$APP_DIR" 2>/dev/null)" ] || die "$APP_DIR exists already, and is not an installation of this installer."
            say "Downloading the program from $REPO ..."
            git clone --quiet "$REPO" "$APP_DIR"
        fi
        # What was changed by hand in the program folder is not kept: the settings and the data are elsewhere
        if git -C "$APP_DIR" rev-parse --quiet --verify "origin/$REF" >/dev/null; then
            git -C "$APP_DIR" checkout --quiet --force -B "$REF" "origin/$REF"
        else
            git -C "$APP_DIR" checkout --quiet --force "$REF" || die "$REF is not a branch, a tag or a commit of the repository."
        fi
        state_set REF "$REF"
        kv_del "$STATE_FILE" SOURCE
    fi

    # The service is started through install/launch.js, which the versions before 2.3.0 do not have
    [ -f "$APP_DIR/install/launch.js" ] || die "This version of the program is older than its installer (2.3.0): choose a newer one with --branch, such as --branch develop."

    # The packages are part of the repository; they are only installed when a source came without them
    if [ ! -d "$APP_DIR/node_modules/express" ]; then
        say "Installing the packages ..."
        (cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund --silent)
    fi
    # The service does not own the folder, and can not ask git for the build itself
    rm -f "$APP_DIR/build.json"
    (cd "$APP_DIR" && npm run --silent build-info >/dev/null 2>&1) || true
    own -R root:root "$APP_DIR"
    say "Version $(app_version) is in $APP_DIR."
}

app_version() { node -p "require('$APP_DIR/package.json').version" 2>/dev/null || echo unknown; }

make_user_and_folders() {
    if is_root && ! id "$SERVICE_USER" >/dev/null 2>&1; then
        if [ "$FAMILY" = alpine ]; then
            addgroup -S "$SERVICE_USER"
            adduser -S -D -H -h "$DATA_DIR" -s /sbin/nologin -G "$SERVICE_USER" "$SERVICE_USER"
        else
            useradd --system --user-group --no-create-home --home-dir "$DATA_DIR" --shell "$(command -v nologin || echo /bin/false)" "$SERVICE_USER"
        fi
    fi
    mkdir -p "$ETC_DIR" "$DATA_DIR/sslcert" "$LOG_DIR"
    own -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR" "$LOG_DIR"
    chmod 750 "$DATA_DIR" "$LOG_DIR"
    chmod 700 "$DATA_DIR/sslcert"
}

# What the service reads before anything else: what must not be changed in the browser
write_environment() {
    [ -f "$ENV_FILE" ] || { : > "$ENV_FILE"; chmod 640 "$ENV_FILE"; }
    [ -n "$(kv_get "$ENV_FILE" ODIN_SECRET)" ] || kv_set "$ENV_FILE" ODIN_SECRET "$(random_hex 32)"
    kv_set "$ENV_FILE" ODIN_SETTINGS_FILE "$SETTINGS_FILE"
    kv_set "$ENV_FILE" ODIN_LOG_FOLDER "$LOG_DIR"
    kv_set "$ENV_FILE" ODIN_HTTPS_KEY "$DATA_DIR/sslcert/server.key"
    kv_set "$ENV_FILE" ODIN_HTTPS_CERT "$DATA_DIR/sslcert/server.crt"
    kv_set "$ENV_FILE" ODIN_ACME_FOLDER "$DATA_DIR/sslcert/letsencrypt"
    own "root:$SERVICE_USER" "$ENV_FILE"
    chmod 640 "$ENV_FILE"
}

###--- The questions of the configuration

settings() { ODIN_SECRET=$(kv_get "$ENV_FILE" ODIN_SECRET) node "$APP_DIR/install/settings.js" "$SETTINGS_FILE" "$@"; }

# default_of SETTING VARIABLE FALLBACK - what is saved already, else the variable of the environment, else the fallback
default_of() {
    if [ -f "$SETTINGS_FILE" ]; then settings get "$1" 2>/dev/null && return; fi
    eval "d_value=\${$2-}"
    printf '%s\n' "${d_value:-$3}"
}

wizard() {
    step "Configuration"
    say "Press Enter to take the value in the brackets. Everything can be changed later,"
    say "on the Settings page of the user interface or with: sh install.sh configure"
    while :; do
        say ""
        ask W_NAME "Name of this server" "$(default_of serverName ODIN_SERVER_NAME "$(hostname)")"
        ask W_COMPANY "Company or owner, shown next to it" "$(default_of companyName ODIN_COMPANY_NAME YourCompany)"

        say ""
        say "The DNS server. 0.0.0.0 listens on every address of this machine; 127.0.0.1 only for the machine itself."
        ask W_ADDRESS "Listen address" "$(default_of serverIPAddress ODIN_NS_ADDRESS 0.0.0.0)"
        ask W_PORT "Port" "$(default_of nsServerPort ODIN_NS_PORT 53)"
        ask W_UPSTREAM "Upstream DNS servers for the other names, comma separated" "$(default_of nsUpstreamServers ODIN_NS_UPSTREAM 1.1.1.1,1.0.0.1)"

        w_default=n; [ "$(default_of nsDnssec ODIN_NS_DNSSEC off)" = off ] || w_default=y
        if ask_yes "Validate the forwarded answers with DNSSEC?" "$w_default"; then
            W_DNSSEC=$(default_of nsDnssec ODIN_NS_DNSSEC validate); [ "$W_DNSSEC" != off ] || W_DNSSEC=validate
        else W_DNSSEC=off
        fi

        say ""
        say "The query log records what every client looks up, for the Queries and Clients pages."
        w_default=y; [ "$(default_of nsQueryLogEnabled ODIN_NS_QUERY_LOG_ENABLED true)" = true ] || w_default=n
        if ask_yes "Record the queries?" "$w_default"; then W_QUERY_LOG=true; else W_QUERY_LOG=false; fi

        say ""
        say "The user interface and the management API."
        W_HTTPS=no
        w_source=$(default_of httpsCertSource ODIN_HTTPS_CERT_SOURCE custom)
        if [ "$(default_of httpsEnabled ODIN_HTTPS_ENABLED false)" = true ] && [ "$w_source" = custom ]; then
            say "HTTPS with a certificate of your own is set up, and is kept as it is."
            W_HTTPS=keep
        else
            w_domains=$(default_of httpsDomains ODIN_HTTPS_DOMAINS "")
            w_default=n; [ -z "$w_domains" ] || w_default=y
            say "HTTPS with a certificate of Let's Encrypt needs a public name that leads to this server,"
            say "and port 80 of it reaching this server from the internet."
            if ask_yes "Use HTTPS with a certificate of Let's Encrypt?" "$w_default"; then
                W_HTTPS=letsencrypt
                ask W_DOMAINS "Public name(s) of this server, comma separated" "$w_domains"
                ask W_EMAIL "E-mail for the account at Let's Encrypt (may be empty)" "$(default_of acmeEmail ODIN_ACME_EMAIL "")"
                ask W_WEB_PORT "HTTPS port" "$(default_of httpsServerPort ODIN_HTTPS_PORT 443)"
            else
                ask W_WEB_PORT "HTTP port" "$(default_of httpServerPort ODIN_HTTP_PORT 45451)"
            fi
        fi

        if apply_settings; then break; fi
        [ "$ASSUME_YES" = 0 ] || die "The configuration was not accepted; see the reasons above."
        say ""
        warn "Some of the answers were not accepted, for the reasons above. Once more:"
    done
    own "$SERVICE_USER:$SERVICE_USER" "$SETTINGS_FILE"
}

apply_settings() {
    set -- type=PROD "serverName=$W_NAME" "companyName=$W_COMPANY" "serverIPAddress=$W_ADDRESS" "nsServerPort=$W_PORT" \
        "nsUpstreamServers=$W_UPSTREAM" "nsDnssec=$W_DNSSEC" "nsQueryLogEnabled=$W_QUERY_LOG"
    case $W_HTTPS in
        letsencrypt)
            [ -n "$W_DOMAINS" ] || { warn "HTTPS with Let's Encrypt needs a public name."; return 1; }
            set -- "$@" httpEnabled=true httpsEnabled=true httpsCertSource=letsencrypt "httpsDomains=$W_DOMAINS" "acmeEmail=$W_EMAIL" "httpsServerPort=$W_WEB_PORT" ;;
        no) set -- "$@" httpEnabled=true httpsEnabled=false "httpServerPort=$W_WEB_PORT" ;;
    esac
    settings set "$@"
}

# Where the user interface is, of what is saved
web_port() {
    if [ "$(settings get httpsEnabled)" = true ]; then settings get httpsServerPort; else settings get httpServerPort; fi
}
web_address() {
    w_scheme=http; w_host=$(primary_address)
    if [ "$(settings get httpsEnabled)" = true ]; then
        w_scheme=https
        w_name=$(settings get httpsDomains | cut -d, -f1)
        [ -z "$w_name" ] || w_host=$w_name
    fi
    printf '%s://%s:%s' "$w_scheme" "$w_host" "$(web_port)"
}

# The first account. It is only made by the server when the database has no users yet.
admin_account() {
    [ -z "$(state_get ADMIN_ASKED)" ] || return 0
    step "The admin account"
    say "It is created at the first start, when the database has no users yet."
    ask ADMIN_USER "Username" "${FREYA_ADMIN_USER:-admin}"
    ADMIN_PASSWORD=${FREYA_ADMIN_PWD:-}
    while [ "$ASSUME_YES" = 0 ]; do
        ask_secret ADMIN_PASSWORD "Password, 8 characters or more (empty: one is made for you)"
        [ -n "$ADMIN_PASSWORD" ] || break
        if [ "${#ADMIN_PASSWORD}" -lt 8 ]; then warn "That is shorter than 8 characters."; continue; fi
        ask_secret a_again "The password again"
        [ "$a_again" = "$ADMIN_PASSWORD" ] && break
        warn "The two differ."
    done
    ADMIN_GENERATED=0
    if [ -z "$ADMIN_PASSWORD" ]; then ADMIN_PASSWORD=$(random_hex 9); ADMIN_GENERATED=1; fi
    kv_set "$ENV_FILE" FREYA_ADMIN_USER "$ADMIN_USER"
    kv_set "$ENV_FILE" FREYA_ADMIN_PWD "$ADMIN_PASSWORD"
    state_set ADMIN_ASKED 1
}

###--- MongoDB

# MongoDB 5 and newer need AVX on x86, and ARMv8.2 on ARM
cpu_modern() {
    case $ARCH in
        x86_64) grep -qw avx /proc/cpuinfo ;;
        aarch64) grep -qw atomics /proc/cpuinfo ;;
        *) return 1 ;;
    esac
}

mongo_repo_url() {
    case $FAMILY in
        debian) printf 'https://repo.mongodb.org/apt/%s/dists/%s/mongodb-org/%s/Release' "$OS_ID" "$OS_CODENAME" "$MONGO_VERSION" ;;
        rhel) printf 'https://repo.mongodb.org/yum/redhat/%s/mongodb-org/%s/%s/repodata/repomd.xml' "${OS_VERSION%%.*}" "$MONGO_VERSION" "$ARCH" ;;
    esac
}

# Is there a package of MongoDB, of its makers, for this system?
mongo_local_possible() {
    [ "$INIT" = systemd ] && cpu_modern || return 1
    case $FAMILY in
        debian)
            [ "$RASPBERRY" = 0 ] || return 1
            case "$OS_ID/$ARCH" in ubuntu/x86_64|ubuntu/aarch64|debian/x86_64) ;; *) return 1 ;; esac ;;
        rhel) case $ARCH in x86_64|aarch64) ;; *) return 1 ;; esac ;;
        *) return 1 ;;
    esac
    curl -fsI "$(mongo_repo_url)" >/dev/null 2>&1
}

mongo_docker_possible() {
    case $ARCH in x86_64|aarch64) ;; *) return 1 ;; esac
    have docker || [ "$FAMILY" = debian ] || [ "$FAMILY" = alpine ]
}

install_mongo_local() {
    say "Installing MongoDB $MONGO_VERSION from repo.mongodb.org ..."
    if [ "$FAMILY" = debian ]; then
        m_key=/usr/share/keyrings/mongodb-server-$MONGO_VERSION.gpg
        curl -fsSL "https://www.mongodb.org/static/pgp/server-$MONGO_VERSION.asc" | gpg --dearmor --yes -o "$m_key"
        m_part=main; [ "$OS_ID" != ubuntu ] || m_part=multiverse
        printf 'deb [ signed-by=%s ] https://repo.mongodb.org/apt/%s %s/mongodb-org/%s %s\n' "$m_key" "$OS_ID" "$OS_CODENAME" "$MONGO_VERSION" "$m_part" \
            > "/etc/apt/sources.list.d/mongodb-org-$MONGO_VERSION.list"
        APT_UPDATED=0
    else
        cat > "/etc/yum.repos.d/mongodb-org-$MONGO_VERSION.repo" <<EOF
[mongodb-org-$MONGO_VERSION]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/${OS_VERSION%%.*}/mongodb-org/$MONGO_VERSION/$ARCH/
gpgcheck=1
enabled=1
gpgkey=https://pgp.mongodb.com/server-$MONGO_VERSION.asc
EOF
    fi
    pkg mongodb-org
    systemctl enable --now mongod >/dev/null 2>&1
    state_set MONGO local
}

install_mongo_docker() {
    if ! have docker; then
        say "Installing Docker ..."
        if [ "$FAMILY" = alpine ]; then pkg docker || die "Docker could not be installed: enable the community repository in /etc/apk/repositories."
        else pkg docker.io
        fi
        state_set DOCKER_INSTALLED 1
    fi
    if [ "$INIT" = systemd ]; then systemctl enable --now docker >/dev/null 2>&1
    elif [ "$INIT" = openrc ]; then rc-update add docker default >/dev/null 2>&1 || true; rc-service docker start >/dev/null 2>&1 || true
    fi
    d_wait=0
    until docker info >/dev/null 2>&1; do
        d_wait=$((d_wait + 1)); [ "$d_wait" -le 30 ] || die "Docker does not start."
        sleep 1
    done

    d_tag=$MONGO_VERSION
    if ! cpu_modern; then
        d_tag=$MONGO_OLD_TAG
        say "This processor does not run MongoDB 5 or newer (no AVX, or older than ARMv8.2): MongoDB $d_tag is used."
    fi
    if docker inspect "$CONTAINER" >/dev/null 2>&1; then
        docker start "$CONTAINER" >/dev/null
    else
        say "Starting MongoDB $d_tag in the container $CONTAINER ..."
        docker volume create "$VOLUME" >/dev/null
        docker run -d --name "$CONTAINER" --restart unless-stopped -p 127.0.0.1:27017:27017 -v "$VOLUME:/data/db" "mongo:$d_tag" >/dev/null
    fi
    state_set MONGO docker
}

database() {
    step "The database"
    d_current=$(kv_get "$ENV_FILE" FREYA_DB_URI)
    if [ -n "$d_current" ]; then
        if ask_yes "Keep the database that is set up: $(mask_uri "$d_current")?" y; then return; fi
    fi

    d_local="mongodb://127.0.0.1:27017/$DB_NAME"
    # Given beforehand, for an installation that asks nothing
    if [ -n "${FREYA_DB_URI:-}" ] && [ -z "$d_current" ]; then
        kv_set "$ENV_FILE" FREYA_DB_URI "$FREYA_DB_URI"
        say "Using $(mask_uri "$FREYA_DB_URI")."
        return
    fi

    set --
    if wait_port 127.0.0.1 27017 0; then set -- "$@" here "Use the MongoDB server that runs on this machine already"; fi
    if mongo_local_possible; then set -- "$@" local "Install MongoDB $MONGO_VERSION on this machine"; fi
    if mongo_docker_possible; then set -- "$@" docker "Run MongoDB in a Docker container on this machine"; fi
    set -- "$@" existing "Use a MongoDB server that runs elsewhere"

    if [ $# -eq 2 ]; then
        say "MongoDB has no package and no container image for this system (${PRETTY_NAME:-$OS_ID}, $ARCH):"
        say "the manager needs a MongoDB server on another machine."
    fi
    case ${ODIN_DB:-} in
        local|docker|existing) d_choice=$ODIN_DB ;;
        *) choose d_choice "Where is the MongoDB database of the manager?" "$@" ;;
    esac

    case $d_choice in
        here) d_uri=$d_local ;;
        local) mongo_local_possible || die "MongoDB can not be installed from its packages on this system."; install_mongo_local; d_uri=$d_local ;;
        docker) mongo_docker_possible || die "MongoDB can not run in a container on this system."; install_mongo_docker; d_uri=$d_local ;;
        existing)
            while :; do
                ask d_uri "Connection string of the MongoDB server" "${FREYA_DB_URI:-mongodb://user:password@host:27017/$DB_NAME}"
                case $d_uri in mongodb://*|mongodb+srv://*) break ;; esac
                [ "$ASSUME_YES" = 0 ] || die "FREYA_DB_URI has to be a mongodb:// connection string."
                warn "A connection string starts with mongodb:// or mongodb+srv://"
            done ;;
    esac
    kv_set "$ENV_FILE" FREYA_DB_URI "$d_uri"

    if [ "$d_choice" != existing ]; then
        say "Waiting for MongoDB to answer ..."
        wait_port 127.0.0.1 27017 "$WAIT" || warn "MongoDB does not answer on 127.0.0.1:27017 yet. The service waits a minute for it when it starts."
    fi
}

###--- What stands in the way of port 53, and the firewall

# The stub of systemd-resolved listens on 127.0.0.53:53, which every address (0.0.0.0) includes
free_port_53() {
    [ "$INIT" = systemd ] || return 0
    [ "$(settings get nsServerPort)" = 53 ] || return 0
    case $(settings get serverIPAddress) in 0.0.0.0|::|127.0.0.53) ;; *) return 0 ;; esac
    systemctl is-active --quiet systemd-resolved 2>/dev/null || return 0
    [ ! -f "$RESOLVED_DROPIN" ] || return 0

    step "Port 53"
    say "systemd-resolved listens on 127.0.0.53:53, where the DNS server has to listen as well."
    say "Its listener can be switched off: the DNS server then answers the names this machine itself looks up."
    if ask_yes "Switch off the listener of systemd-resolved?" y; then
        mkdir -p "$(dirname "$RESOLVED_DROPIN")"
        printf '# Made by the installer of %s: its DNS server listens on port 53\n[Resolve]\nDNSStubListener=no\n' "$NAME" > "$RESOLVED_DROPIN"
        systemctl restart systemd-resolved
        state_set RESOLVED 1
    else
        warn "The DNS server will not start on port 53 of every address. Choose the address of this machine instead: sh install.sh configure"
    fi
}

firewall() {
    f_port=$(web_port); f_dns=$(settings get nsServerPort)
    if have ufw && ufw status 2>/dev/null | grep -q '^Status: active'; then
        step "Firewall"
        if ask_yes "Open port $f_dns (DNS) and $f_port (user interface) in ufw?" y; then
            ufw allow "$f_dns" >/dev/null; ufw allow "$f_port/tcp" >/dev/null
            state_set FIREWALL "ufw $f_dns $f_port"
        fi
    elif have firewall-cmd && firewall-cmd --state >/dev/null 2>&1; then
        step "Firewall"
        if ask_yes "Open port $f_dns (DNS) and $f_port (user interface) in firewalld?" y; then
            firewall-cmd --quiet --permanent --add-port="$f_dns/udp" --add-port="$f_dns/tcp" --add-port="$f_port/tcp"
            firewall-cmd --quiet --reload
            state_set FIREWALL "firewalld $f_dns $f_port"
        fi
    fi
}

close_firewall() {
    # shellcheck disable=SC2046
    set -- $(state_get FIREWALL)
    [ $# -eq 3 ] || return 0
    case $1 in
        ufw) ufw delete allow "$2" >/dev/null 2>&1 || true; ufw delete allow "$3/tcp" >/dev/null 2>&1 || true ;;
        firewalld)
            firewall-cmd --quiet --permanent --remove-port="$2/udp" --remove-port="$2/tcp" --remove-port="$3/tcp" 2>/dev/null || true
            firewall-cmd --quiet --reload 2>/dev/null || true ;;
    esac
    kv_del "$STATE_FILE" FIREWALL
}

###--- The service

service_installed() { [ -f "$UNIT_FILE" ] || [ -f "$RC_FILE" ]; }

install_service() {
    step "The service"
    s_node=$(command -v node)
    case $INIT in
        systemd)
            cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Odin NS Manager: DNS server, management API and user interface
Documentation=https://github.com/csabatibortoth/odin-ns-manager
After=network-online.target mongod.service docker.service
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR
ExecStart=$s_node $APP_DIR/install/launch.js $ENV_FILE
Restart=always
RestartSec=5
# Port 53, and port 80 for Let's Encrypt, without being root
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR $LOG_DIR

[Install]
WantedBy=multi-user.target
EOF
            systemctl daemon-reload
            systemctl enable "$NAME" >/dev/null 2>&1 ;;
        openrc)
            cat > "$RC_FILE" <<EOF
#!/sbin/openrc-run
# Made by the installer of $NAME

name="Odin NS Manager"
description="DNS server, management API and user interface"
supervisor=supervise-daemon
command="$s_node"
command_args="$APP_DIR/install/launch.js $ENV_FILE"
command_user="$SERVICE_USER:$SERVICE_USER"
directory="$APP_DIR"
# Port 53, and port 80 for Let's Encrypt, without being root
capabilities="^cap_net_bind_service"
output_log="$LOG_DIR/console.log"
error_log="$LOG_DIR/console.log"
respawn_delay=5

depend() {
    need net
    after docker firewall
}
EOF
            chmod 755 "$RC_FILE"
            : >> "$LOG_DIR/console.log"; own "$SERVICE_USER:$SERVICE_USER" "$LOG_DIR/console.log"
            rc-update add "$NAME" default >/dev/null 2>&1 ;;
        *) die "Neither systemd nor OpenRC runs on this system: the service can not be installed." ;;
    esac
    say "The service $NAME is installed, and starts with the system."
}

service_do() {
    case $INIT in
        systemd) systemctl "$1" "$NAME" ;;
        openrc) rc-service "$NAME" "$1" ;;
        *) warn "There is no service manager to $1 the service with." ;;
    esac
}

start_service() {
    step "Starting"
    if service_installed; then service_do restart >/dev/null 2>&1 || service_do start; fi
    s_port=$(web_port)
    say "Waiting for the user interface on port $s_port ..."
    if wait_port 127.0.0.1 "$s_port" "$WAIT"; then
        say "The service runs."
        STARTED=1
    else
        STARTED=0
        warn "The user interface does not answer on port $s_port yet. Look at the log: $(log_hint)"
    fi
    # The password of the first account is only read at the first start: it does not stay in the file
    if [ "$STARTED" = 1 ] && [ -n "$(kv_get "$ENV_FILE" FREYA_ADMIN_PWD)" ]; then kv_del "$ENV_FILE" FREYA_ADMIN_PWD; fi
}

log_hint() {
    if [ "$INIT" = systemd ]; then printf 'journalctl -u %s -e' "$NAME"; else printf 'tail -n 50 %s/console.log' "$LOG_DIR"; fi
}

summary() {
    step "Done"
    say "Odin NS Manager $(app_version) is installed."
    say ""
    say "  User interface:  $(web_address)"
    say "  DNS server:      $(settings get serverIPAddress) port $(settings get nsServerPort)   (try: nslookup example.com $(primary_address))"
    if [ -n "${ADMIN_USER:-}" ]; then
        say "  Sign in as:      $ADMIN_USER"
        if [ "${ADMIN_GENERATED:-0}" = 1 ]; then
            say "  Password:        $ADMIN_PASSWORD"
            say "                   Change it on the Account page: it is not shown again."
        fi
        say "                   (This account is only made when the database had no users yet.)"
    fi
    say ""
    say "  Settings:        $ENV_FILE and the Settings page"
    say "  Logs:            $LOG_DIR, and: $(log_hint)"
    say "  Update:          sh $APP_DIR/install/install.sh update"
    say "  Uninstall:       sh $APP_DIR/install/install.sh uninstall"
}

###--- The commands

require_root() { is_root || [ -n "${ODIN_INSTALL_TEST:-}" ] || die "Run this as root: sudo sh $0 ${COMMAND}"; }
require_installed() { [ -f "$STATE_FILE" ] && [ -d "$APP_DIR" ] || die "Odin NS Manager is not installed here. Install it with: sh $0 install"; }

do_install() {
    require_root
    detect_system
    say "Odin NS Manager - installation on ${PRETTY_NAME:-$OS_ID} ($ARCH)"
    if [ -f "$STATE_FILE" ] && [ -d "$APP_DIR" ]; then
        say "It is installed here already."
        ask_yes "Install over it, keeping its settings and data?" y || exit 0
    fi
    [ "$INIT" != none ] || die "Neither systemd nor OpenRC runs on this system: the service can not be installed."

    mkdir -p "$ETC_DIR"
    install_tools
    install_node
    fetch_app
    make_user_and_folders
    write_environment
    wizard
    database
    admin_account
    free_port_53
    firewall
    install_service
    start_service
    summary
}

do_update() {
    require_root
    require_installed
    detect_system
    u_old=$(app_version); u_commit=$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo "")
    [ -n "$SOURCE_DIR" ] || SOURCE_DIR=$(state_get SOURCE)
    install_tools
    install_node
    fetch_app
    make_user_and_folders
    write_environment
    install_service
    start_service
    step "Done"
    say "Updated from $u_old${u_commit:+ ($u_commit)} to $(app_version)."
    [ -z "$u_commit" ] || say "To go back: sh $APP_DIR/install/install.sh update --branch $u_commit"
    say "What changed, and what to look at after it: the release notes in $APP_DIR/README.md"
}

do_configure() {
    require_root
    require_installed
    detect_system
    wizard
    database
    free_port_53
    firewall
    start_service
    step "Done"
    say "The configuration is saved. User interface: $(web_address)"
}

do_status() {
    require_installed
    detect_system
    say "Odin NS Manager $(app_version) in $APP_DIR"
    say "User interface: $(web_address)"
    say "Database: $(mask_uri "$(kv_get "$ENV_FILE" FREYA_DB_URI)")"
    service_do status || true
}

do_uninstall() {
    require_root
    detect_system
    [ -f "$STATE_FILE" ] || service_installed || [ -d "$APP_DIR" ] || die "Odin NS Manager is not installed here."
    say "Odin NS Manager - removal"
    ask_yes "Remove the service and the program?" y || exit 0

    # Read before the folder they are noted in is gone
    x_mongo=$(state_get MONGO); x_node=$(state_get NODE_INSTALLED); x_docker=$(state_get DOCKER_INSTALLED)
    x_uri=$(kv_get "$ENV_FILE" FREYA_DB_URI)

    step "The service"
    if service_installed; then
        service_do stop >/dev/null 2>&1 || true
        if [ "$INIT" = systemd ]; then
            systemctl disable "$NAME" >/dev/null 2>&1 || true
            rm -f "$UNIT_FILE"; systemctl daemon-reload
        else
            rc-update del "$NAME" default >/dev/null 2>&1 || true
            rm -f "$RC_FILE"
        fi
    fi
    close_firewall
    if [ -f "$RESOLVED_DROPIN" ]; then
        rm -f "$RESOLVED_DROPIN"
        systemctl restart systemd-resolved 2>/dev/null || true
        say "The listener of systemd-resolved is switched on again."
    fi
    [ ! -d "$APP_DIR" ] || remove_dir "$APP_DIR"
    say "The service and the program are removed."

    step "The data"
    x_purge=$PURGE
    if [ "$x_purge" = 0 ] && [ "$ASSUME_YES" = 0 ]; then
        say "The settings, the certificates and the logs are in $ETC_DIR, $DATA_DIR and $LOG_DIR."
        if ask_yes "Remove them as well?" n; then x_purge=1; fi
    fi
    if [ "$x_purge" = 1 ]; then
        # The database first, while what is known about it is still there
        case $x_mongo in
            docker)
                if [ "$PURGE" = 1 ] || ask_yes "Remove the MongoDB container and its data (the zones, records, users and the query log)?" n; then
                    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
                    docker volume rm "$VOLUME" >/dev/null 2>&1 || true
                    say "The container $CONTAINER and its data are removed."
                    [ -z "$x_docker" ] || say "Docker itself was installed for it, and is left in place."
                fi ;;
            local)
                if [ "$PURGE" = 1 ] || ask_yes "Delete the database $DB_NAME (the zones, records, users and the query log)?" n; then
                    if have mongosh && mongosh --quiet "$x_uri" --eval 'db.dropDatabase()' >/dev/null 2>&1; then say "The database is deleted."
                    else warn "The database could not be deleted: mongosh \"$(mask_uri "$x_uri")\" --eval 'db.dropDatabase()'"
                    fi
                fi
                say "MongoDB itself is left in place. To remove it: the package mongodb-org." ;;
            *) [ -z "$x_uri" ] || say "The database at $(mask_uri "$x_uri") is not touched." ;;
        esac
        remove_dir "$ETC_DIR"; remove_dir "$DATA_DIR"; remove_dir "$LOG_DIR"
        if id "$SERVICE_USER" >/dev/null 2>&1; then
            if [ "$FAMILY" = alpine ]; then deluser "$SERVICE_USER" >/dev/null 2>&1 || true
            else userdel "$SERVICE_USER" >/dev/null 2>&1 || true
            fi
        fi
        say "The settings, the certificates, the logs and the user $SERVICE_USER are removed."
    else
        say "Kept: $ETC_DIR, $DATA_DIR, $LOG_DIR and the database. A new installation finds them again."
    fi
    [ -z "$x_node" ] || say "Node.js was installed for the manager, and is left in place: other programs may use it by now."
    step "Done"
}

usage() { sed -n '2,/^set -eu/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

###--- Start

while [ $# -gt 0 ]; do
    case $1 in
        install|update|configure|uninstall|status) COMMAND=$1 ;;
        -y|--yes) ASSUME_YES=1 ;;
        --purge) PURGE=1 ;;
        --branch) [ $# -ge 2 ] || die "--branch needs a name"; REF=$2; shift ;;
        --source) [ $# -ge 2 ] || die "--source needs a folder"; SOURCE_DIR=$(cd "$2" && pwd) || die "$2 is not a folder"; shift ;;
        -h|--help|help) usage; exit 0 ;;
        *) die "Unknown argument: $1 (see: sh $0 --help)" ;;
    esac
    shift
done

open_terminal
trap 'stty echo <&3 2>/dev/null || true' EXIT
trap 'printf "\nStopped.\n"; exit 130' INT

if [ -z "$COMMAND" ]; then
    [ "$ASSUME_YES" = 0 ] || die "Say what to do: install, update, configure, uninstall or status."
    if [ -f "$STATE_FILE" ]; then
        choose COMMAND "Odin NS Manager is installed here. What would you like to do?" \
            update "Update it to the newest version" configure "Go through the configuration again" \
            status "Show the state of the service" uninstall "Uninstall it"
    else
        choose COMMAND "Odin NS Manager - what would you like to do?" install "Install it" uninstall "Remove what is left of an installation"
    fi
fi

case $COMMAND in
    install) do_install ;;
    update) do_update ;;
    configure) do_configure ;;
    uninstall) do_uninstall ;;
    status) do_status ;;
esac
