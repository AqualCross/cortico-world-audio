# Changelog

## 0.1.9

- 补齐 `cortico-world-compose` 的致谢与 MIT 许可：`src/music-abc/band.js` 的律动型与 band 编曲器改编自其 `src/grooves.ts` / `src/arrange.ts`（Copyright (c) 2026 Phantivia）。README、`THIRD_PARTY_NOTICES.md` 和 `licenses/cortico-world-compose-MIT.txt` 都记录了来源。
- 发布记录：0.1.7、0.1.8 的说明已在仓库与 npm 包的 `CHANGELOG.md` 里；0.1.7 当时从工作区直接发布，没有独立提交，因此无法补出准确的 tag。0.1.8 起在发布提交上打 Git 标签。

## 0.1.8

- 修复 ffmpeg 下载 404：BtbN 的 autobuild 标签只保留最近几天，之前钉死的 `autobuild-2026-11-01-12-49` 已被上游清理。Windows/Linux 改用 `latest` 标签下名字固定的资产，下载前从同一 release 的 `checksums.sha256` 现取 SHA-256；macOS 仍钉版本与哈希。

## 0.1.7

- 音乐页改为一级页签：分离、混音、作曲、编曲、音源、记录。原「乐谱」更名「作曲」，原「乐器」更名「音源」；「作品」并入「记录」，与分离/混音作品同页、同一卡片格式。
- 作曲/编曲增加 band 编曲：11 种律动、energy 1–5、分段覆盖、停拍、过门、swing、人性化、每角色混音；引号和弦驱动伴奏，写谱不变。
- 渲染回执带测量事实（小节、声部音域、超域、重复/节奏、级进/跳进、和弦冲突音、RMS/峰值）；和弦冲突音只报调外冲突，调内 9/11/13 度张力不误报。
- 检查/渲染失败保留 ABC 草稿，`audio_abc_music_score` 支持 `drafts` / `draft`。
- 写谱支持动机宏（`% motif 名字: ...`、`@名字+1`）和命名块局部修订（`% block: A` … `% end: A`，`action=revise`）。
- 作曲/编曲增加「导出 MIDI」，按当前谱/编曲设置即时生成，不落 MIDI 文件。作品记录只保存 WAV，不再保存谱面快照、MIDI/ABC 文件。
- 新增 `audio_open`：用系统默认播放器打开音频文件，不走播放队列。

## 0.1.6

- 修复 Linux x64 下安装卡在 `onnxruntime-node` 的 NuGet 302 报错，以及 Windows 下与 `sherpa-onnx-node` 同进程共存时的 `onnxruntime.dll` 冲突：`onnxruntime-node` 钉在 `1.17.0`（自带 6 个平台/架构的 CPU 预编译二进制且无 `postinstall` 脚本，不再请求 `api.nuget.org` 拉取 CUDA 12 原生包，解包体积从 307 MB 降到 101 MB）；`loadOnnxRuntime()` 先加载 `sherpa-onnx-node`，让两者在 Windows 下共用 1.28.2 的 `onnxruntime.dll`。

## 0.1.5

- 参考音频导入支持任意格式：WAV 校验改成看 RIFF/WAVE 头（改扩展名的假 WAV 会被挡下），其他格式（mp3/flac/m4a/ogg 等）交给 ffmpeg 转成 16 kHz 单声道 WAV；没装 ffmpeg 时提示先装或自行转换。说话页的选择器与拖拽文案同步放宽。
- 云端合成写分阶段日志：按 request / response / download / failed 回报目标 host、字数与各阶段耗时，卡住时能看出停在哪一段；失败时区分自己的超时与队列取消。
- 混音输出从 24 bit 改为 16 bit PCM，避免部分客户端拒收。

## 0.1.4

- FireRed 监听不再吃满 CPU：VAD 与 AED 的 ONNX 会话改为单线程、顺序执行并关闭空闲自旋。onnxruntime 默认按物理核开线程池、线程空闲时自旋等活，监听有声音时几十个核都在空转（64 线程机器上实测 30.8 核 → 0.04 核），单帧延迟反而略降；AED 60 秒块约 0.4 秒，不受影响。

## 0.1.3

- 说话改为流式：Edge、本机 GPT-SoVITS 与 OpenAI 兼容接口边合成边交给 ffmpeg 解码播放，不再等整句；播放队列在当前句开播时预取下一条，连续说话不再等合成。缺 ffmpeg 或原生输出时自动退回收齐再播；流式 WAV 落盘前补长度，记录能读出准确时长。
- Edge 连接按音色复用，同一音色连说不再每次重连；新建连接约 1 秒的代价只付一次，之后首音约 0.3 秒。
- 说话首块 PCM 到达时写一条「说话首音」日志（`worlds.audio`），带播放等待与合成耗时。

## 0.1.2

- 播放支持左右平衡：新增 `worlds.audio.balance`（-100 全左 … 100 全右，0 居中）和播放页滑杆；`audio_play`、`audio_say` 可按条或按句指定 `balance`。原生 PCM 输出按左右声道衰减；Windows 的 PowerShell 兜底同步支持，Linux 的 ffplay 兜底使用 pan 滤镜；macOS 的 afplay 没有左右调节，退回它时该参数不生效。

## 0.1.1

- 市场卡片不再标「仅 Windows」：去掉继承自声音扩展的 `os` 限制，三个平台的安装不再被标记限制。

## 0.1.0

- 从 `cortico-world-voice` 分出的跨平台版本，包名 `@aqualcross/cortico-world-audio`。
- 按应用监听：Windows / Linux 提供系统声音、麦克风与按应用三路；macOS 只有麦克风，界面隐藏不可用来源。
- 「说话」默认引擎为 Edge 朗读（免密钥、免安装，需要联网），默认音色 `zh-CN-XiaoyiNeural`；合成结果是 mp3，附件类型与文件名跟随实际格式。
- 跨平台适配：`loopback-capture` 改为可选依赖，macOS 不再因它安装失败；系统声音在 Windows 走 WASAPI、Linux 走 PipeWire，macOS 只提供麦克风；播放兜底按平台（Windows PowerShell、macOS afplay、Linux ffplay）；结束进程按平台；ffmpeg 与 uv 三个平台都可在依赖页点击下载（Windows/Linux 用 BtbN，macOS 用 evermeet / osxexperts）；GPT-SoVITS 模型链接改用 symlink；桌面字幕仅 Windows；macOS 不显示系统声音与按应用来源；POSIX 卸载会先清掉占用目录的残留进程。
- uv/ffmpeg 不再猜安装目录：uv 只认配置与 PATH 裸名，ffmpeg 从 PATH 解析真实路径并写回配置。
- 移除 audio_listen 工具：监听只能从「听」页开启，避免模型主动开启监听被市场标记为读取隐私。
- 本地 GPT-SoVITS / RVC / DiffSinger 只在 Windows 上验证过；macOS 与 Linux 为尽力支持。
