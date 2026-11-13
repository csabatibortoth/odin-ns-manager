<#
.SYNOPSIS
Odin NS Manager - installer for Windows (10, 11, Server 2016 or newer).

.DESCRIPTION
Installs what the manager needs (Node.js, Git, MongoDB), asks the questions of
the configuration, and runs the manager as a service: a task of the Task
Scheduler that starts with Windows, runs as "Local Service", and is started
again when it stops.

  powershell -ExecutionPolicy Bypass -File install.ps1              a menu of what follows
  powershell -ExecutionPolicy Bypass -File install.ps1 install      install, configure and start
  powershell -ExecutionPolicy Bypass -File install.ps1 update       bring it to the newest version
  powershell -ExecutionPolicy Bypass -File install.ps1 configure    ask the questions again
  powershell -ExecutionPolicy Bypass -File install.ps1 uninstall    remove it; asks before any data is removed
  powershell -ExecutionPolicy Bypass -File install.ps1 status       the state of the service

What is installed where:
  C:\Program Files\OdinNsManager     the program
  C:\ProgramData\OdinNsManager       odin.env (the key of the tokens, the database, the folders),
                                     settings.json (what the Settings page saves), the certificates and the logs

.PARAMETER Yes
Do not ask: take the defaults, or the ODIN_* variables of the environment:
ODIN_SERVER_NAME ODIN_COMPANY_NAME ODIN_NS_ADDRESS ODIN_NS_PORT ODIN_NS_UPSTREAM ODIN_NS_DNSSEC
ODIN_NS_QUERY_LOG_ENABLED ODIN_HTTP_PORT ODIN_HTTPS_DOMAINS ODIN_ACME_EMAIL ODIN_HTTPS_PORT
ODIN_DB (local|existing) FREYA_DB_URI FREYA_ADMIN_USER FREYA_ADMIN_PWD

.PARAMETER Branch
The branch, tag or commit to install. Default: master, or the installed one.

.PARAMETER Source
Install from a folder that holds the project, instead of the repository.

.PARAMETER Purge
With uninstall: also remove the settings, the certificates and the logs.
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)][ValidateSet('', 'install', 'update', 'configure', 'uninstall', 'status')][string]$Command = '',
    [switch]$Yes,
    [string]$Branch = '',
    [string]$Source = '',
    [switch]$Purge
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # downloads are many times faster without the progress bar

$Name = 'OdinNsManager'
$Title = 'Odin NS Manager'
$Repo = if ($env:ODIN_REPO) { $env:ODIN_REPO } else { 'https://github.com/csabatibortoth/odin-ns-manager.git' }
$AppDir = if ($env:ODIN_APP_DIR) { $env:ODIN_APP_DIR } else { Join-Path $env:ProgramFiles $Name }
$DataDir = if ($env:ODIN_DATA_DIR) { $env:ODIN_DATA_DIR } else { Join-Path $env:ProgramData $Name }
$EnvFile = Join-Path $DataDir 'odin.env'
$StateFile = Join-Path $DataDir 'install.state'
$SettingsFile = Join-Path $DataDir 'settings.json'
$LogDir = Join-Path $DataDir 'logs'
$CertDir = Join-Path $DataDir 'sslcert'
$MinNode = 22
$NodeMajor = if ($env:ODIN_NODE_MAJOR) { $env:ODIN_NODE_MAJOR } else { '22' }
$DbName = 'odin-ns-manager'
$Wait = if ($env:ODIN_WAIT) { [int]$env:ODIN_WAIT } else { 90 }
$Testing = [bool]$env:ODIN_INSTALL_TEST
$script:AssumeYes = [bool]$Yes
$script:Admin = $null

###--- Talking to the person who installs

function Say([string]$Text = '') { Write-Host $Text }
function Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Cyan }
function Warn([string]$Text) { Write-Host "WARNING: $Text" -ForegroundColor Yellow }
function Fail([string]$Text) { throw $Text }

function Ask([string]$Question, [string]$Default = '') {
    if ($script:AssumeYes) { return $Default }
    $prompt = if ($Default -ne '') { "$Question [$Default]" } else { $Question }
    $answer = Read-Host $prompt
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    return $answer.Trim()
}

function AskSecret([string]$Question) {
    if ($script:AssumeYes) { return '' }
    $secure = Read-Host $Question -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function AskYes([string]$Question, [bool]$Default) {
    while ($true) {
        $hint = if ($Default) { '(Y/n)' } else { '(y/N)' }
        $answer = Ask "$Question $hint"
        if ($answer -eq '') { return $Default }
        if ($answer -match '^(y|yes)$') { return $true }
        if ($answer -match '^(n|no)$') { return $false }
    }
}

# Choose "Question" @(@('key', 'Label'), ...) - the first one is the default
function Choose([string]$Question, [array]$Options) {
    Say $Question
    for ($i = 0; $i -lt $Options.Count; $i++) { Say ("  {0}) {1}" -f ($i + 1), $Options[$i][1]) }
    while ($true) {
        $pick = Ask 'Choose' '1'
        if ($pick -match '^\d+$' -and [int]$pick -ge 1 -and [int]$pick -le $Options.Count) { return $Options[[int]$pick - 1][0] }
    }
}

###--- Small tools

# Files of NAME=value lines: the environment of the service, and the notes of this installer
function KvGet([string]$File, [string]$Key) {
    if (-not (Test-Path -LiteralPath $File)) { return '' }
    $value = ''
    foreach ($line in [IO.File]::ReadAllLines($File)) { if ($line.StartsWith("$Key=")) { $value = $line.Substring($Key.Length + 1) } }
    return $value
}

function KvSet([string]$File, [string]$Key, $Value) {
    $lines = @()
    if (Test-Path -LiteralPath $File) { $lines = @([IO.File]::ReadAllLines($File) | Where-Object { -not $_.StartsWith("$Key=") }) }
    if ($null -ne $Value) { $lines += "$Key=$Value" }
    # Without a byte order mark: the launcher reads the names as they are
    [IO.File]::WriteAllLines($File, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
}

function KvDel([string]$File, [string]$Key) { if (Test-Path -LiteralPath $File) { KvSet $File $Key $null } }
function StateGet([string]$Key) { KvGet $StateFile $Key }
function StateSet([string]$Key, [string]$Value) { KvSet $StateFile $Key $Value }

function RandomHex([int]$Bytes) {
    $buffer = New-Object byte[] $Bytes
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function MaskUri([string]$Uri) { return ($Uri -replace '//[^@/]*@', '//***@') }
function Have([string]$Program) { return [bool](Get-Command $Program -ErrorAction SilentlyContinue) }

# The programs that were just installed are found without a new console
function RefreshPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

# Runs a program, and stops when it fails. What it prints is shown as it is.
function Run([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { Fail "$Program $($Arguments -join ' ') failed (exit code $LASTEXITCODE)." }
}

# Asks git something that may fail: true when it went well, or what it printed with -Output
function GitQuiet([string[]]$Arguments, [switch]$Output) {
    $ErrorActionPreference = 'Continue'
    $printed = & git @Arguments 2>$null
    if ($Output) { return $printed }
    return ($LASTEXITCODE -eq 0)
}

function TestPort([string]$TargetHost, [int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $attempt = $client.BeginConnect($TargetHost, $Port, $null, $null)
        if (-not $attempt.AsyncWaitHandle.WaitOne(2000)) { return $false }
        $client.EndConnect($attempt)
        return $true
    } catch { return $false }
    finally { $client.Close() }
}

function WaitPort([string]$TargetHost, [int]$Port, [int]$Seconds) {
    $until = (Get-Date).AddSeconds($Seconds)
    while ($true) {
        if (TestPort $TargetHost $Port) { return $true }
        if ((Get-Date) -ge $until) { return $false }
        Start-Sleep -Seconds 1
    }
}

function PrimaryAddress {
    try {
        $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop | Sort-Object RouteMetric | Select-Object -First 1
        $address = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction Stop | Select-Object -First 1
        if ($address) { return $address.IPAddress }
    } catch { }
    return $env:COMPUTERNAME
}

# Only what this installer made is ever removed
function RemoveDir([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    if ((Split-Path $Path -Leaf) -ne $Name) { Warn "Not removed, as it is not a folder of ${Title}: $Path"; return }
    Remove-Item -LiteralPath $Path -Recurse -Force
}

function IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Starts the script again with administrator rights, in a window of its own
function RequireAdmin {
    if ($Testing -or (IsAdmin)) { return }
    if ($script:AssumeYes) { Fail 'Run this in a PowerShell that was started as administrator.' }
    Say 'Administrator rights are needed: confirm the question of Windows.'
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', "`"$PSCommandPath`"", $script:Command)
    if ($Branch) { $arguments += @('-Branch', $Branch) }
    if ($Source) { $arguments += @('-Source', "`"$Source`"") }
    if ($Purge) { $arguments += '-Purge' }
    Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs
    exit 0
}

function RequireInstalled {
    if (-not ((Test-Path -LiteralPath $StateFile) -and (Test-Path -LiteralPath $AppDir))) {
        Fail "$Title is not installed here. Install it with: install.ps1 install"
    }
}

###--- Components

function WingetInstall([string]$Id) {
    if (-not (Have 'winget')) { return $false }
    Say "Installing $Id with winget ..."
    & winget install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Null
    RefreshPath
    # winget answers with its own code when the newest version is there already
    return ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq -1978335189)
}

function NodeOk {
    if (-not (Have 'node')) { return $false }
    try { return ([int](& node -p 'process.versions.node.split(".")[0]') -ge $MinNode) } catch { return $false }
}

# The installer of nodejs.org, checked against the list of its checksums
function InstallNodeMsi {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $base = "https://nodejs.org/dist/latest-v$NodeMajor.x"
    $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content -split "`n"
    $line = $sums | Where-Object { $_ -match "node-v[\d.]+-$arch\.msi\s*$" } | Select-Object -First 1
    if (-not $line) { Fail "nodejs.org has no installer of Node.js $NodeMajor for $arch." }
    $hash, $file = ($line.Trim() -split '\s+')
    $target = Join-Path $env:TEMP $file
    Say "Downloading $file ..."
    Invoke-WebRequest -UseBasicParsing "$base/$file" -OutFile $target
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash -ne $hash) { Fail "The download of $file is damaged." }
    $process = Start-Process msiexec.exe -ArgumentList @('/i', "`"$target`"", '/qn', '/norestart') -Wait -PassThru
    Remove-Item -LiteralPath $target -Force
    if ($process.ExitCode -notin 0, 3010) { Fail "The installer of Node.js failed (exit code $($process.ExitCode))." }
    RefreshPath
}

function InstallNode {
    Step 'Node.js'
    if (NodeOk) { Say "Node.js $(& node --version) is installed."; return }
    if (Have 'node') { Say "Node.js $(& node --version) is too old: $MinNode or newer is needed." }
    if (-not ((WingetInstall 'OpenJS.NodeJS.LTS') -and (NodeOk))) { InstallNodeMsi }
    if (-not (NodeOk)) { Fail "Node.js $MinNode or newer could not be installed. Install it from https://nodejs.org and start again." }
    StateSet 'NODE_INSTALLED' '1'
    Say "Node.js $(& node --version) is installed."
}

function InstallGit {
    if ($Source -or (Have 'git')) { return }
    Step 'Git'
    if ((WingetInstall 'Git.Git') -and (Have 'git')) { StateSet 'GIT_INSTALLED' '1'; Say 'Git is installed.'; return }
    Say 'Git is not there, and could not be installed: the program is downloaded as an archive instead.'
}

###--- The program

function AppVersion {
    try { return (Get-Content -Raw -LiteralPath (Join-Path $AppDir 'package.json') | ConvertFrom-Json).version } catch { return 'unknown' }
}

function CopySource([string]$From) {
    if (-not (Test-Path -LiteralPath (Join-Path $From 'server.js'))) { Fail "$From does not hold the project: server.js is missing." }
    Say "Copying the program from $From ..."
    New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
    # robocopy answers 0 to 7 when it went well
    & robocopy $From $AppDir /MIR /XD .git sslcert /XF settings.json build.json /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "Copying the program failed (robocopy exit code $LASTEXITCODE)." }
    $global:LASTEXITCODE = 0
}

# Without git: the archive of the branch or tag, from GitHub
function DownloadArchive([string]$Ref) {
    $base = $Repo -replace '\.git$', ''
    $folder = Join-Path $env:TEMP "$Name-download"
    if (Test-Path -LiteralPath $folder) { Remove-Item -LiteralPath $folder -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    $zip = Join-Path $folder 'source.zip'
    Say "Downloading $Ref from $base ..."
    Invoke-WebRequest -UseBasicParsing "$base/archive/$Ref.zip" -OutFile $zip
    Run 'tar.exe' @('-xf', $zip, '-C', $folder)
    $unpacked = Get-ChildItem -LiteralPath $folder -Directory | Select-Object -First 1
    CopySource $unpacked.FullName
    Remove-Item -LiteralPath $folder -Recurse -Force
}

function FetchApp {
    Step $Title
    $from = if ($Source) { $Source } else { StateGet 'SOURCE' }
    if ($from) {
        CopySource ((Resolve-Path -LiteralPath $from).Path)
        StateSet 'SOURCE' $from
    } else {
        $ref = if ($Branch) { $Branch } else { StateGet 'REF' }
        if (-not $ref) { $ref = 'master' }
        if (Have 'git') {
            if (Test-Path -LiteralPath (Join-Path $AppDir '.git')) {
                Say "Fetching the newest of $ref ..."
                Run 'git' @('-C', $AppDir, 'fetch', '--quiet', '--tags', '--force', 'origin')
            } else {
                if ((Test-Path -LiteralPath $AppDir) -and (Get-ChildItem -LiteralPath $AppDir -Force | Select-Object -First 1)) {
                    # An installation that was made from an archive: it is replaced by the repository
                    if (Test-Path -LiteralPath (Join-Path $AppDir 'server.js')) { RemoveDir $AppDir }
                    else { Fail "$AppDir exists already, and is not an installation of this installer." }
                }
                Say "Downloading the program from $Repo ..."
                Run 'git' @('clone', '--quiet', $Repo, $AppDir)
            }
            # What was changed by hand in the program folder is not kept: the settings and the data are elsewhere
            if (GitQuiet @('-C', $AppDir, 'rev-parse', '--quiet', '--verify', "origin/$ref")) { Run 'git' @('-C', $AppDir, 'checkout', '--quiet', '--force', '-B', $ref, "origin/$ref") }
            else { Run 'git' @('-C', $AppDir, 'checkout', '--quiet', '--force', $ref) }
        } else {
            DownloadArchive $ref
        }
        StateSet 'REF' $ref
        KvDel $StateFile 'SOURCE'
    }

    # The service is started through installlaunch.js, which the versions before 2.3.0 do not have
    if (-not (Test-Path -LiteralPath (Join-Path $AppDir 'installlaunch.js'))) {
        Fail 'This version of the program is older than its installer (2.3.0): choose a newer one with -Branch, such as -Branch develop.'
    }

    Push-Location $AppDir
    try {
        # The packages are part of the repository; they are only installed when a source came without them
        if (-not (Test-Path -LiteralPath 'node_modules\express')) {
            Say 'Installing the packages ...'
            Run 'npm.cmd' @('install', '--omit=dev', '--no-audit', '--no-fund', '--silent')
        }
        # The service can not ask git for the build itself
        if (Test-Path -LiteralPath 'build.json') { Remove-Item -LiteralPath 'build.json' -Force }
        if (Test-Path -LiteralPath '.git') { & npm.cmd run --silent build-info | Out-Null; $global:LASTEXITCODE = 0 }
    } finally { Pop-Location }
    Say "Version $(AppVersion) is in $AppDir."
}

# The folder of the settings is for the administrators and the service only: it holds the key of the tokens
function MakeFolders {
    foreach ($folder in $DataDir, $LogDir, $CertDir) { New-Item -ItemType Directory -Force -Path $folder | Out-Null }
    if ($Testing) { return }
    # By their identifiers, as the names differ with the language of Windows: Administrators, SYSTEM, Local Service
    & icacls $DataDir /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' /T /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { Warn "The access rights of $DataDir could not be set." }
}

# What the service reads before anything else: what must not be changed in the browser
function WriteEnvironment {
    if (-not (KvGet $EnvFile 'ODIN_SECRET')) { KvSet $EnvFile 'ODIN_SECRET' (RandomHex 32) }
    KvSet $EnvFile 'ODIN_SETTINGS_FILE' $SettingsFile
    KvSet $EnvFile 'ODIN_LOG_FOLDER' $LogDir
    KvSet $EnvFile 'ODIN_CONSOLE_LOG' (Join-Path $LogDir 'console.log')
    KvSet $EnvFile 'ODIN_HTTPS_KEY' (Join-Path $CertDir 'server.key')
    KvSet $EnvFile 'ODIN_HTTPS_CERT' (Join-Path $CertDir 'server.crt')
    KvSet $EnvFile 'ODIN_ACME_FOLDER' (Join-Path $CertDir 'letsencrypt')
}

###--- The questions of the configuration

# Runs install\settings.js with the key of the tokens; returns what it printed, and whether it went well
function Settings([string[]]$Arguments) {
    $previous = $env:ODIN_SECRET
    $env:ODIN_SECRET = KvGet $EnvFile 'ODIN_SECRET'
    # What a program writes to its error output is not a failure of this script
    $ErrorActionPreference = 'Continue'
    try {
        $output = & node (Join-Path $AppDir 'install\settings.js') $SettingsFile @Arguments 2>&1 | ForEach-Object { "$_" }
        return @{ Ok = ($LASTEXITCODE -eq 0); Output = (@($output) -join "`n") }
    } finally { $env:ODIN_SECRET = $previous }
}

function SettingGet([string]$Key) { return (Settings @('get', $Key)).Output.Trim() }

# What is saved already, else the variable of the environment, else the fallback
function DefaultOf([string]$Key, [string]$Variable, [string]$Fallback) {
    if (Test-Path -LiteralPath $SettingsFile) { return SettingGet $Key }
    $given = [Environment]::GetEnvironmentVariable($Variable)
    if ($given) { return $given }
    return $Fallback
}

function Wizard {
    Step 'Configuration'
    Say 'Press Enter to take the value in the brackets. Everything can be changed later,'
    Say 'on the Settings page of the user interface or with: install.ps1 configure'
    while ($true) {
        Say
        $set = @('type=PROD')
        $set += 'serverName=' + (Ask 'Name of this server' (DefaultOf 'serverName' 'ODIN_SERVER_NAME' $env:COMPUTERNAME.ToLower()))
        $set += 'companyName=' + (Ask 'Company or owner, shown next to it' (DefaultOf 'companyName' 'ODIN_COMPANY_NAME' 'YourCompany'))

        Say
        Say 'The DNS server. 0.0.0.0 listens on every address of this machine; 127.0.0.1 only for the machine itself.'
        $set += 'serverIPAddress=' + (Ask 'Listen address' (DefaultOf 'serverIPAddress' 'ODIN_NS_ADDRESS' '0.0.0.0'))
        $set += 'nsServerPort=' + (Ask 'Port' (DefaultOf 'nsServerPort' 'ODIN_NS_PORT' '53'))
        $set += 'nsUpstreamServers=' + (Ask 'Upstream DNS servers for the other names, comma separated' (DefaultOf 'nsUpstreamServers' 'ODIN_NS_UPSTREAM' '1.1.1.1,1.0.0.1'))

        $dnssec = DefaultOf 'nsDnssec' 'ODIN_NS_DNSSEC' 'off'
        if (AskYes 'Validate the forwarded answers with DNSSEC?' ($dnssec -ne 'off')) { if ($dnssec -eq 'off') { $dnssec = 'validate' } } else { $dnssec = 'off' }
        $set += "nsDnssec=$dnssec"

        Say
        Say 'The query log records what every client looks up, for the Queries and Clients pages.'
        $record = AskYes 'Record the queries?' ((DefaultOf 'nsQueryLogEnabled' 'ODIN_NS_QUERY_LOG_ENABLED' 'true') -eq 'true')
        $set += 'nsQueryLogEnabled=' + $record.ToString().ToLower()

        Say
        Say 'The user interface and the management API.'
        if (((DefaultOf 'httpsEnabled' 'ODIN_HTTPS_ENABLED' 'false') -eq 'true') -and ((DefaultOf 'httpsCertSource' 'ODIN_HTTPS_CERT_SOURCE' 'custom') -eq 'custom')) {
            Say 'HTTPS with a certificate of your own is set up, and is kept as it is.'
        } else {
            $domains = DefaultOf 'httpsDomains' 'ODIN_HTTPS_DOMAINS' ''
            Say "HTTPS with a certificate of Let's Encrypt needs a public name that leads to this server,"
            Say 'and port 80 of it reaching this server from the internet.'
            if (AskYes "Use HTTPS with a certificate of Let's Encrypt?" ($domains -ne '')) {
                $set += @('httpEnabled=true', 'httpsEnabled=true', 'httpsCertSource=letsencrypt')
                $set += 'httpsDomains=' + (Ask 'Public name(s) of this server, comma separated' $domains)
                $set += 'acmeEmail=' + (Ask "E-mail for the account at Let's Encrypt (may be empty)" (DefaultOf 'acmeEmail' 'ODIN_ACME_EMAIL' ''))
                $set += 'httpsServerPort=' + (Ask 'HTTPS port' (DefaultOf 'httpsServerPort' 'ODIN_HTTPS_PORT' '443'))
            } else {
                $set += @('httpEnabled=true', 'httpsEnabled=false')
                $set += 'httpServerPort=' + (Ask 'HTTP port' (DefaultOf 'httpServerPort' 'ODIN_HTTP_PORT' '45451'))
            }
        }

        $result = Settings (@('set') + $set)
        if ($result.Ok) { break }
        Warn $result.Output
        if ($script:AssumeYes) { Fail 'The configuration was not accepted; see the reasons above.' }
        Say
        Warn 'Some of the answers were not accepted, for the reasons above. Once more:'
    }
}

function WebPort { if ((SettingGet 'httpsEnabled') -eq 'true') { return [int](SettingGet 'httpsServerPort') } else { return [int](SettingGet 'httpServerPort') } }

function WebAddress {
    $scheme = 'http'; $target = PrimaryAddress
    if ((SettingGet 'httpsEnabled') -eq 'true') {
        $scheme = 'https'
        $first = ((SettingGet 'httpsDomains') -split ',')[0]
        if ($first) { $target = $first }
    }
    return "${scheme}://${target}:$(WebPort)"
}

# The first account. It is only made by the server when the database has no users yet.
function AdminAccount {
    if (StateGet 'ADMIN_ASKED') { return }
    Step 'The admin account'
    Say 'It is created at the first start, when the database has no users yet.'
    $user = Ask 'Username' $(if ($env:FREYA_ADMIN_USER) { $env:FREYA_ADMIN_USER } else { 'admin' })
    $password = "$env:FREYA_ADMIN_PWD"
    while (-not $script:AssumeYes) {
        $password = AskSecret 'Password, 8 characters or more (empty: one is made for you)'
        if ($password -eq '') { break }
        if ($password.Length -lt 8) { Warn 'That is shorter than 8 characters.'; continue }
        if ((AskSecret 'The password again') -ceq $password) { break }
        Warn 'The two differ.'
    }
    $generated = $false
    if ($password -eq '') { $password = RandomHex 9; $generated = $true }
    KvSet $EnvFile 'FREYA_ADMIN_USER' $user
    KvSet $EnvFile 'FREYA_ADMIN_PWD' $password
    StateSet 'ADMIN_ASKED' '1'
    $script:Admin = @{ User = $user; Password = $password; Generated = $generated }
}

###--- MongoDB

function InstallMongo {
    if (-not (WingetInstall 'MongoDB.Server')) { Fail 'MongoDB could not be installed with winget. Install MongoDB Community Server from https://www.mongodb.com/try/download/community (as a service), and start again.' }
    $service = Get-Service -Name 'MongoDB' -ErrorAction SilentlyContinue
    if ($service) {
        Set-Service -Name 'MongoDB' -StartupType Automatic
        if ($service.Status -ne 'Running') { Start-Service -Name 'MongoDB' }
    }
    StateSet 'MONGO' 'local'
}

function Database {
    Step 'The database'
    $current = KvGet $EnvFile 'FREYA_DB_URI'
    if ($current -and (AskYes "Keep the database that is set up: $(MaskUri $current)?" $true)) { return }

    $local = "mongodb://127.0.0.1:27017/$DbName"
    # Given beforehand, for an installation that asks nothing
    if ($env:FREYA_DB_URI -and -not $current) {
        KvSet $EnvFile 'FREYA_DB_URI' $env:FREYA_DB_URI
        Say "Using $(MaskUri $env:FREYA_DB_URI)."
        return
    }

    $options = @()
    if (TestPort '127.0.0.1' 27017) { $options += , @('here', 'Use the MongoDB server that runs on this machine already') }
    if (Have 'winget') { $options += , @('local', 'Install MongoDB on this machine') }
    $options += , @('existing', 'Use a MongoDB server that runs elsewhere')

    $choice = if ($env:ODIN_DB -in 'local', 'existing') { $env:ODIN_DB } else { Choose 'Where is the MongoDB database of the manager?' $options }
    switch ($choice) {
        'here' { $uri = $local }
        'local' { InstallMongo; $uri = $local }
        'existing' {
            while ($true) {
                $uri = Ask 'Connection string of the MongoDB server' $(if ($env:FREYA_DB_URI) { $env:FREYA_DB_URI } else { "mongodb://user:password@host:27017/$DbName" })
                if ($uri -match '^mongodb(\+srv)?://') { break }
                if ($script:AssumeYes) { Fail 'FREYA_DB_URI has to be a mongodb:// connection string.' }
                Warn 'A connection string starts with mongodb:// or mongodb+srv://'
            }
        }
    }
    KvSet $EnvFile 'FREYA_DB_URI' $uri

    if ($choice -ne 'existing') {
        Say 'Waiting for MongoDB to answer ...'
        if (-not (WaitPort '127.0.0.1' 27017 $Wait)) { Warn 'MongoDB does not answer on 127.0.0.1:27017 yet. The service waits a minute for it when it starts.' }
    }
}

###--- Port 53 and the firewall

function CheckPort53 {
    $port = [int](SettingGet 'nsServerPort')
    try { $taken = @(Get-NetUDPEndpoint -LocalPort $port -ErrorAction Stop) } catch { return }
    $owners = @($taken | ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName } | Where-Object { $_ -and $_ -ne 'node' } | Sort-Object -Unique)
    if (-not $owners) { return }
    Step "Port $port"
    Warn "Port $port is in use already, by: $($owners -join ', ')."
    Say 'The DNS server can not listen on an address another program listens on. This is often the DNS Server role,'
    Say 'or Internet Connection Sharing (which Hyper-V, WSL and the mobile hotspot use). Stop that program, or choose'
    Say 'the address of this machine instead of 0.0.0.0: install.ps1 configure'
}

function Firewall {
    if ($Testing) { return }
    $dns = [int](SettingGet 'nsServerPort'); $web = WebPort
    Step 'Firewall'
    if (-not (AskYes "Open port $dns (DNS) and $web (user interface) in the Windows firewall?" $true)) { return }
    CloseFirewall
    New-NetFirewallRule -Group $Title -DisplayName "$Title - DNS (UDP)" -Direction Inbound -Action Allow -Protocol UDP -LocalPort $dns | Out-Null
    New-NetFirewallRule -Group $Title -DisplayName "$Title - DNS (TCP)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $dns | Out-Null
    New-NetFirewallRule -Group $Title -DisplayName "$Title - user interface" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $web | Out-Null
    if ((SettingGet 'httpsCertSource') -eq 'letsencrypt' -and (SettingGet 'httpsEnabled') -eq 'true') {
        New-NetFirewallRule -Group $Title -DisplayName "$Title - Let's Encrypt challenge" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ([int](SettingGet 'acmeHttpPort')) | Out-Null
    }
    Say 'The ports are open.'
}

function CloseFirewall {
    if ($Testing) { return }
    Get-NetFirewallRule -Group $Title -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

###--- The service: a task of the Task Scheduler

function TaskExists { return [bool](Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) }

function InstallService {
    Step 'The service'
    if ($Testing) { Say '(not installed while testing)'; return }
    $node = (Get-Command node).Source
    # "Local Service", by its identifier: the name differs with the language of Windows
    $account = (New-Object Security.Principal.SecurityIdentifier 'S-1-5-19').Translate([Security.Principal.NTAccount]).Value
    $action = New-ScheduledTaskAction -Execute $node -Argument "`"$(Join-Path $AppDir 'install\launch.js')`" `"$EnvFile`"" -WorkingDirectory $AppDir
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType ServiceAccount -RunLevel Limited
    $options = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Principal $principal -Settings $options `
        -Description "$Title - DNS server, management API and user interface" -Force | Out-Null
    Say "The task $Name is installed, and starts with Windows."
}

function StopService {
    if (-not (TaskExists)) { return }
    Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    # The task is stopped at once; the program gets a moment to let go of its ports
    Start-Sleep -Seconds 2
}

function StartService {
    Step 'Starting'
    $started = $false
    if (TaskExists) {
        StopService
        Start-ScheduledTask -TaskName $Name
        $port = WebPort
        Say "Waiting for the user interface on port $port ..."
        $started = WaitPort '127.0.0.1' $port $Wait
        if ($started) { Say 'The service runs.' }
        else { Warn "The user interface does not answer on port $port yet. Look at the log: $(Join-Path $LogDir 'console.log')" }
    }
    # The password of the first account is only read at the first start: it does not stay in the file
    if ($started -and (KvGet $EnvFile 'FREYA_ADMIN_PWD')) { KvDel $EnvFile 'FREYA_ADMIN_PWD' }
}

function Summary {
    Step 'Done'
    Say "$Title $(AppVersion) is installed."
    Say
    Say "  User interface:  $(WebAddress)"
    Say "  DNS server:      $(SettingGet 'serverIPAddress') port $(SettingGet 'nsServerPort')   (try: nslookup example.com $(PrimaryAddress))"
    if ($script:Admin) {
        Say "  Sign in as:      $($script:Admin.User)"
        if ($script:Admin.Generated) {
            Say "  Password:        $($script:Admin.Password)"
            Say '                   Change it on the Account page: it is not shown again.'
        }
        Say '                   (This account is only made when the database had no users yet.)'
    }
    Say
    Say "  Settings:        $EnvFile and the Settings page"
    Say "  Logs:            $LogDir"
    Say "  Start and stop:  Start-ScheduledTask $Name / Stop-ScheduledTask $Name"
    Say "  Update:          powershell -ExecutionPolicy Bypass -File `"$(Join-Path $AppDir 'install\install.ps1')`" update"
    Say "  Uninstall:       powershell -ExecutionPolicy Bypass -File `"$(Join-Path $AppDir 'install\install.ps1')`" uninstall"
}

###--- The commands

function DoInstall {
    RequireAdmin
    Say "$Title - installation on $((Get-CimInstance Win32_OperatingSystem).Caption)"
    if ((Test-Path -LiteralPath $StateFile) -and (Test-Path -LiteralPath $AppDir)) {
        Say 'It is installed here already.'
        if (-not (AskYes 'Install over it, keeping its settings and data?' $true)) { return }
    }
    MakeFolders
    InstallNode
    InstallGit
    StopService
    FetchApp
    WriteEnvironment
    Wizard
    Database
    AdminAccount
    CheckPort53
    Firewall
    InstallService
    StartService
    Summary
}

function DoUpdate {
    RequireAdmin
    RequireInstalled
    $old = AppVersion
    $commit = ''
    if ((Have 'git') -and (Test-Path -LiteralPath (Join-Path $AppDir '.git'))) { $commit = "$(GitQuiet @('-C', $AppDir, 'rev-parse', '--short', 'HEAD') -Output)".Trim() }
    MakeFolders
    InstallNode
    InstallGit
    # Windows does not let go of the files of a program that runs
    StopService
    FetchApp
    WriteEnvironment
    InstallService
    StartService
    Step 'Done'
    Say "Updated from $old$(if ($commit) { " ($commit)" }) to $(AppVersion)."
    if ($commit) { Say "To go back: install.ps1 update -Branch $commit" }
    Say "What changed, and what to look at after it: the release notes in $(Join-Path $AppDir 'README.md')"
}

function DoConfigure {
    RequireAdmin
    RequireInstalled
    Wizard
    Database
    CheckPort53
    Firewall
    StartService
    Step 'Done'
    Say "The configuration is saved. User interface: $(WebAddress)"
}

function DoStatus {
    RequireInstalled
    Say "$Title $(AppVersion) in $AppDir"
    Say "User interface: $(WebAddress)"
    Say "Database: $(MaskUri (KvGet $EnvFile 'FREYA_DB_URI'))"
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($task) {
        $info = $task | Get-ScheduledTaskInfo
        Say "Service: $($task.State); last started $($info.LastRunTime)"
    } else { Say 'Service: the task is not installed' }
}

function DoUninstall {
    RequireAdmin
    if (-not ((Test-Path -LiteralPath $StateFile) -or (TaskExists) -or (Test-Path -LiteralPath $AppDir))) { Fail "$Title is not installed here." }
    Say "$Title - removal"
    if (-not (AskYes 'Remove the service and the program?' $true)) { return }

    # Read before the folder they are noted in is gone
    $mongo = StateGet 'MONGO'; $node = StateGet 'NODE_INSTALLED'; $git = StateGet 'GIT_INSTALLED'
    $uri = KvGet $EnvFile 'FREYA_DB_URI'

    Step 'The service'
    if (TaskExists) { StopService; Unregister-ScheduledTask -TaskName $Name -Confirm:$false }
    CloseFirewall
    # The folder of this script may be the one that is removed
    Set-Location $env:SystemRoot
    RemoveDir $AppDir
    Say 'The service, its firewall rules and the program are removed.'

    Step 'The data'
    $all = [bool]$Purge
    if (-not $all -and -not $script:AssumeYes) {
        Say "The settings, the certificates and the logs are in $DataDir."
        $all = AskYes 'Remove them as well?' $false
    }
    if ($all) {
        RemoveDir $DataDir
        Say 'The settings, the certificates and the logs are removed.'
    } else {
        Say "Kept: $DataDir. A new installation finds it again."
    }
    if ($uri) {
        Say "The database is not touched: $(MaskUri $uri)"
        Say "To delete it:  mongosh `"$(MaskUri $uri)`" --eval `"db.dropDatabase()`""
    }
    if ($mongo -eq 'local') { Say 'MongoDB was installed for the manager, and is left in place. To remove it: winget uninstall MongoDB.Server' }
    if ($node) { Say 'Node.js was installed for the manager, and is left in place: other programs may use it by now.' }
    if ($git) { Say 'Git was installed for the manager, and is left in place.' }
    Step 'Done'
}

###--- Start

try {
    if ($Source) { $Source = (Resolve-Path -LiteralPath $Source).Path }
    $script:Command = $Command
    if (-not $script:Command) {
        if ($script:AssumeYes) { Fail 'Say what to do: install, update, configure, uninstall or status.' }
        if (Test-Path -LiteralPath $StateFile) {
            $script:Command = Choose "$Title is installed here. What would you like to do?" @(
                @('update', 'Update it to the newest version'), @('configure', 'Go through the configuration again'),
                @('status', 'Show the state of the service'), @('uninstall', 'Uninstall it'))
        } else {
            $script:Command = Choose "$Title - what would you like to do?" @(@('install', 'Install it'), @('uninstall', 'Remove what is left of an installation'))
        }
    }
    switch ($script:Command) {
        'install' { DoInstall }
        'update' { DoUpdate }
        'configure' { DoConfigure }
        'uninstall' { DoUninstall }
        'status' { DoStatus }
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
