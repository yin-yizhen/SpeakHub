# SpeakHub Windows 打包与发布流程

当用户要求打包、生成安装包、升级版本或发布 SpeakHub 时，先读本文件和 `docs/code-map.md`。以当前仓库代码和本次用户要求为准；历史聊天用于解释流程，不是执行新发布的授权。

## 项目入口与默认分工

| 项目 | 当前配置 |
| --- | --- |
| 仓库 | `https://github.com/yin-yizhen/SpeakHub` |
| 历史发布分支 | `master`；执行前仍检查实际分支和远端 |
| 版本来源 | `package.json` 的 `version`，格式 `X.Y.Z` |
| 打包入口 | `pnpm package:win`，内部先执行 `pnpm build` |
| 产物 | `release/SpeakHub-X.Y.Z-Setup.exe` |
| 平台 | Windows x64，Electron + NSIS |
| 安装配置 | `package.json` 的 `build` 和 `build/installer.nsh` |
| 更新实现 | `src/main/update-service.ts`、`src/main/installer-launcher.ts`、`src/renderer/use-app-updates.ts` |
| 更新验证 | `update-service.test.ts`、`installer-launcher.test.ts`、`App.voice.test.tsx` |

用户此前通常要求“源码提交到 GitHub，安装包我自己上传”：完成源码验证、提交推送和本地安装包交付；用户负责 GitHub Release 上传。后续遵循本次请求：

- 仅“打包”：本地验证并生成安装包，不自动推送源码或发布 Release。
- 明确“提交/推送 GitHub”：将本次待发布源码提交并推送到核实后的分支。
- 明确“我自己上传”：交付安装包、SHA-256 和 Release 文案；不创建或上传 Release。
- 明确要求代为发布 Release：在全部验证通过后执行；已经授权的步骤无需重复确认。

## 1. 核对当前源码和版本

```powershell
git status --short
git branch --show-current
git remote -v
git log -5 --oneline
Get-Content package.json
gh release list --repo yin-yizhen/SpeakHub --limit 5 --json tagName,isLatest,isDraft,isPrerelease,publishedAt
```

1. 阅读 `docs/code-map.md`，说明本次主要模块、相关测试和真实验收链路。需要改代码时按索引定位，不凭 UI 截图猜修复点。
2. 识别用户已有修改、未提交修改和已提交但未推送的提交，保留它们。安装包必须包含这次确定要发布的最新本地修复；不能仅因为 GitHub 有旧源码就拿旧提交打包。
3. 用户指定版本优先。只做本地测试包可保留当前版本，并说明同版本不会触发自动更新。若明确面向已安装用户发布更新而未给编号，默认选高于本地与最新正式 Release 的下一补丁版本，并在开始时说明；有版本计划冲突再确认。
4. 修改 `package.json.version` 后检查实际 diff。不要使用会隐式创建提交/tag 的升版命令，除非本次确实需要。
5. 依赖发生变化时确认 `pnpm-lock.yaml` 与依赖配置一致；不要仅为打包随意更新依赖。

**必须保持一致：源码版本 `X.Y.Z`、安装后应用版本 `X.Y.Z`、Release tag `vX.Y.Z`、安装包 `SpeakHub-X.Y.Z-Setup.exe`。**

## 2. 整理 Git 状态（请求包含提交/推送时）

```powershell
git fetch origin
git log --oneline --left-right HEAD...origin/master
git diff --stat
git diff --check
```

- 核对当前发布目标是否确实是 `master`。如果当前分支不同，先核实应从哪个分支发布，不直接切换并丢弃工作。
- 远端可能有用户在网页修改的 README 等内容。检查差异后安全整合；不强推，不 `reset --hard`，不覆盖用户修改。
- 有未提交修改时先确定发布范围，检查并提交，再进行需要干净工作区的整合。只重放尚未发布的本地提交；已经共享的历史应使用安全合并。
- 不提交 `node_modules/`、`out/`、`release/`、`.playwright-cli/`、`artifacts/`、运行时账号数据或密钥。需要的安装资源由打包配置收集。
- 先形成明确的源码提交，再生成最终包，方便记录安装包对应的提交。后续若又改源码、版本或整合远端，重新验证并重新打包。

## 3. 发布前验证

在仓库根目录执行；任何必需步骤失败，都不能把产物标成发布完成。

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
```

依据 `docs/code-map.md` 验收本次变化的真实链路，至少确认解析、音频/字幕 chunk 或归档入库等相关边界。测试数量从本次输出读取，不照抄历史数字。

打包资源检查：

- `resources/app-icon-rounded.ico` 存在。
- `resources/dictionaries/ecdict-en-zh` 的字典文件完整；缺失时先检查 `scripts/prepare-ecdict.mjs`，准备源 CSV 后按脚本要求生成，不用空字典代替。
- 保留 `build/installer.nsh`：它处理损坏的旧卸载记录、64 位注册表视图及安装范围迁移，不是无用文件。
- `sherpa-onnx-node` 和 Windows x64 原生依赖按 `asarUnpack` 配置打包。
- VAD/Kokoro 模型下载到应用 `userData/speech-models`；不把个人模型、练习记录、API Key 或 ChatGPT 登录数据打进安装包。

## 4. 生成一个全新的最终安装包

本节开始时间与产物核对必须在同一个 PowerShell 会话执行。用命令工具时将两段代码合并到同一次调用，等待该调用完成；不要在新的 shell 中引用已经丢失的 `$packageStartedAt`。

```powershell
$packageStartedAt = Get-Date
pnpm package:win
```

本命令已包含生产构建与 `electron-builder --win --x64`。必须等进程结束并检查退出码；中断的构建、旧目录里仍存在的同名 exe，都不能当成本次成功产物。

```powershell
$packageManifest = Get-Content package.json -Raw | ConvertFrom-Json
$packageVersion = $packageManifest.version
$installerPath = Join-Path (Get-Location) ("release/SpeakHub-{0}-Setup.exe" -f $packageVersion)
if (!(Test-Path -LiteralPath $installerPath)) { throw '没有找到当前版本安装包。' }
$installerInfo = Get-Item -LiteralPath $installerPath
if ($installerInfo.LastWriteTime -lt $packageStartedAt) { throw '安装包不是本次构建生成的。' }
if ($installerInfo.Length -eq 0) { throw '安装包为空。' }
$installerInfo | Select-Object FullName, Length, LastWriteTime
Get-FileHash -LiteralPath $installerPath -Algorithm SHA256
Get-AuthenticodeSignature -LiteralPath $installerPath | Select-Object Status
git rev-parse HEAD
git status --short
```

记录完整路径、文件大小、构建时间、SHA-256 和源码提交。签名是否有效以 Authenticode 结果为准；日志出现 signing 步骤不等于已有可信证书签名。

`release/win-unpacked/` 是解包产物；交付用户上传的通常是 NSIS `Setup.exe`。`.blockmap`、builder 日志或解包目录不能替代安装器。

## 5. 推送源码（仅在本次已要求时）

```powershell
git fetch origin
git status --short
git log --oneline --left-right HEAD...origin/master
git push origin master
git rev-parse HEAD
git ls-remote origin refs/heads/master
```

确认最终提交已推送，并与发布分支的远端 HEAD 一致。若推送前发现远端又有变化，安全整合后重新检查源码和最终安装包；不能用一个源码提交生成包，却声称包对应后来合并的另一个提交。

## 6. 用户手动上传 GitHub Release

用户自行上传时，交付以下操作说明：

1. 打开仓库 Releases，创建新的正式 Release。
2. tag 为 `vX.Y.Z`，指向刚刚核实并推送的源码提交。
3. 标题可用 `SpeakHub vX.Y.Z`；正文写本次实际新增功能、修复和体验优化，正文会显示在应用更新窗口。
4. 上传本次生成的 `SpeakHub-X.Y.Z-Setup.exe`，确认资产大小正确。
5. 发布为非 Draft、非 Pre-release 的正式版本，并确认 `/releases/latest` 指向它。

以后若用户明确要求代为上传，先完成所有本地验证与产物核对，再用 GitHub 工具执行这一步。多行 Release 文案保存为 UTF-8 文件并使用 `gh --notes-file`，不要靠 shell 字符串拼接。

## 7. 自动更新验收

SpeakHub 当前读取：

`https://api.github.com/repos/yin-yizhen/SpeakHub/releases/latest`

- 应用启动约 5 秒后检查，也支持在设置里手动检查。
- 新 Release 的版本必须高于已安装版本。替换同版本安装包、只推送 GitHub 源码、只创建 tag，都不会让同版本用户收到更新提示。
- Release 必须包含可下载的 Windows `.exe`，按规定保留 Setup 文件名。下载检查大小、Windows 文件头及可用的 GitHub SHA-256 digest；有 digest 才会启用第三方镜像回退。
- 更新下载到用户数据目录；安装器由独立进程启动，确认启动后旧应用退出。NSIS 覆盖安装；验收时确认练习归档和设置仍在。
- 这是客户端检查更新，不是发布后立即强制推送或安装到所有电脑。

上传后可只读核对：

```powershell
gh api repos/yin-yizhen/SpeakHub/releases/latest --jq '{tag_name, draft, prerelease, html_url, assets: [.assets[] | {name, size, digest, browser_download_url}]}'
```

使用真实旧版应用检查：能看到新版本和正文 -> 下载完成并校验 -> 安装器启动 -> 旧进程退出 -> 安装后显示新版本且原数据保留。用户还没上传或无法进行旧版实测时，明确标为待验收，不宣称所有客户端已经收到更新。

## 8. 每次交付应报告

- 本次版本号、源码提交；是否提交/推送、是否上传 Release。
- 可点击的安装包绝对路径、大小和 SHA-256。
- 本次实际跑过的验证及未完成的真实验收。
- 是否使用/更新 `docs/code-map.md`，以及工作区是否还有用户原有或未提交的修改。
- 可直接粘贴的 Release 文案；用户自行上传时明确剩余上传步骤。

历史依据：[打包与更新聊天](codex://threads/019fa426-6f85-7760-a492-d6358c74b712)。已核对历史 `v0.2.0`、`v0.2.1`、`v0.2.2` 的交付方式和当前配置；历史 hash、构建时间及测试数量不应用于新安装包。
