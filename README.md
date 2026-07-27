# SpeakSub

SpeakSub 是一个 Windows 英语口语练习工具：它可在 ChatGPT 网页模式或 API 直连模式下显示字幕、保存练习记录，并提供复盘与词汇学习。

## 匿名使用统计

SpeakSub 默认启用最小化匿名使用统计，用于了解应用是否被启动、运行大致多久以及版本使用情况。统计仅在 Electron 主进程中发送，不读取也不发送练习内容。

采集字段：

- 匿名安装标识和本次启动标识；
- 事件类型：`app_open`、`app_heartbeat`、`app_close`；
- 应用版本、操作系统、系统架构，以及正常关闭时的运行秒数。

统计数据在阿里云日志服务（SLS）中保存 90 天。我们不会采集或发送音频、语音/字幕文本、ChatGPT 内容、Cookie、API Key、账号、文件路径、IP 地址或其他自由文本。

“活跃安装数”按匿名安装标识去重，表示活跃安装实例，不等同于真实自然人数量。匿名 WebTracking 入口可能被第三方伪造写入，因此该数据仅用于产品趋势判断，不能作为精确用户审计依据。

## 开发验证

```powershell
pnpm lint
pnpm test
pnpm build
pnpm package:win
```

## 阿里云 SLS 配置

在已有 SLS Project 下创建标准型 Logstore `speaksub-event`，保留 90 天、1 个 Shard、关闭自动分裂；在属性中开启 WebTracking 并关闭“记录外网 IP”。建立全文索引，以及 `app_name`、`event`、`distinct_id`、`session_id`、`app_version`、`os`、`arch`、`is_first_launch`（text）和 `duration_seconds`（long）字段索引。

创建写入处理器 `speaksub-privacy-allowlist`，使用以下 SPL 并关联到该 Logstore：

```text
* | project app_name, event, distinct_id, session_id, app_version, os, arch, is_first_launch, duration_seconds
```

处理失败选择“丢弃原始数据”。发送测试事件后确认入库记录没有 `__source__`、`__client_ip__` 或其他来源/IP 字段。

当前上报地址使用 Sonic 已有 Project 的上海地域：

```text
https://sonic-analysis.cn-shanghai.log.aliyuncs.com/logstores/speaksub-event/track
```

查看活跃安装数：

```sql
event: app_open |
select approx_distinct(distinct_id) as active_installations, count(*) as open_count
```
