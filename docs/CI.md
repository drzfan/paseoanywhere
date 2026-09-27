# CI

两条 workflow，职责严格分离：**JS 层快速检查**（check.yml，push/PR 都跑）与**原生 APK 构建**（apk.yml，手动/tag 才跑）。项目铁律：原生编译只发生在 CI，本机（含 VPS）禁止 gradle / prebuild / pod。

## check.yml — 快速检查

| 项 | 值 |
|---|---|
| 触发 | push 到 `main`、`feat/**` 分支；所有 PR |
| 超时 | 15 分钟（目标实跑 < 5 分钟） |
| 并发 | 同 ref 新 push 自动取消旧 run（`cancel-in-progress`） |
| 步骤 | checkout → setup-bun（bun 缓存）→ `bun install --frozen-lockfile` → `bun run typecheck` → `bun run lint` → `bun run export:web` → 上传 `web-dist` artifact（保留 7 天） |

bun 版本锚定 `1.4.2`（与生成 `bun.lock` 的本机版本一致），升级 bun 时记得同步改。

## apk.yml — APK 构建（debug 先行）

### 触发与总闸

| 项 | 值 |
|---|---|
| 触发 | `workflow_dispatch`（手动，可对任意分支触发）+ push tag `v*` |
| runner | ubuntu-latest（自带 Android SDK，`ANDROID_HOME` 预设）+ JDK temurin 21 |
| 超时 | **360 分钟**（巨型库首跑很慢，宁宽勿死） |
| 权限 | `contents: write`（tag 触发时 `gh release` 挂 APK 需要） |

### 步骤流水线

```
checkout → JDK21 → setup-bun → bun install ──┐（marker 01）
expo prebuild -p android --no-install ────────┤（marker 02，CNG 只在此处生成 android/）
configure native build ──────────────────────┤（marker 03，见下）
restore gradle caches ───────────────────────┤（必须在 prebuild 之后！）
gradlew assembleDebug ───────────────────────┤（marker 04，debug 签名，产物可直接安装）
upload-artifact（+ marker 05）
gh release create（仅 tag 触发；marker 06）
notify agent（always()，成功失败都回调）
```

### 为什么 debug 先行

历史教训：同技术栈曾六连败，死因是 dex/R8 对 400MB 级预编译原生库 OOM + 超时。对策组合：

- **assembleDebug**：无 R8/minify/shrinkResources，绕开最重的死因；
- **arm64-v8a 单 ABI**：jniLibs 只打包一份（省 ~230MB+），CMake 也只编一份；
- **`-Xmx8g`**：模板默认 `org.gradle.jvmargs=-Xmx2048m` 对这种体量必 OOM，提升堆 + 开 `org.gradle.caching`；
- **360 分钟超时**：首跑（冷缓存 + 全量 dex）极慢，不给默认 6 小时外的假超时，也别被 360 分钟掐死。

debug APK 的语义：可直接 `adb install`，但 JS bundle 依赖 Metro dev server（`expo start`）——它验证的是"原生管线能出包"，不是发布物。发布构建（assembleRelease + 自有 keystore）是后续阶段的事。

### 单 ABI 用了哪种方案

**prebuild 后改 `android/gradle.properties`**（不是 app.json）。原因：SDK 56 的 `expo.android` config schema **不支持** `abiFilters` 键；而 RN 0.85 的 gradle-plugin、react-native-nitro-modules、@runanywhere/core 三方的 build.gradle 全都读根项目属性 `reactNativeArchitectures`，所以：

```bash
sed -i 's/^reactNativeArchitectures=.*/reactNativeArchitectures=arm64-v8a/' android/gradle.properties
```

configure 步骤里同时做 heap 提升与 build cache 开关，并有 `grep` 自检（sed 没生效会让步骤直接红，而不是到 gradle 才莫名变慢/OOM）。

另外本分支给 app.json 补了 `expo.android.package: "com.drzfan.paseoanywhere"`——没有它 prebuild 在非交互 CI 下会卡 package 名 prompt（getOrPromptForPackageAsync），这也是 CNG 本该有的锚点。

### 缓存策略（双缓存）

| 缓存 | 由谁管 | 内容 | key |
|---|---|---|---|
| bun 全局缓存 | `oven-sh/setup-bun@v2` 的 `cache: bun` | `~/.bun/install/cache`（400MB 级预编译包的 tarball，装完一次后续秒级解包） | setup-bun 内置（基于 `bun.lock`） |
| gradle 缓存 | `actions/cache@v4` | `~/.gradle/caches` + `~/.gradle/wrapper` + `android/.gradle` + `android/build` + `android/app/build` | `gradle-<os>-<bun.lock hash>-v1`，restore 前缀 `gradle-<os>-` 兜底 |

要点：

- **key 含 `bun.lock` 哈希**：依赖一变缓存自动换代；`v1` 是手动失效旋钮（改模板/gradle 配置后想强制冷跑就 bump）。
- **恢复点在 prebuild 之后**：cache 恢复若发生在 prebuild 前，残留的 `android/` 目录会干扰 prebuild（CNG 要求目录干净）。
- **`save-always: true`**：失败的构建也保存缓存——调试期失败重试时，已经下载的依赖不再重下，这正是六连败坟场里最痛的浪费。
- `android/app/build` 能被跨 run 复用是因为 prebuild 输出确定性（同 app.json + 同 expo 版本 → 同 gradle 工程结构）。

### 如何手动触发 APK 构建

```bash
gh workflow run apk.yml --ref feat/ci        # 或 main / 任意分支
gh run watch                                 # 或去 Actions 页看
```

产物：artifact `apk-debug-arm64-v8a`（30 天），文件名 `paseoanywhere-<ref>-debug-arm64-v8a.apk`（实测 ≈56MB，含预编译语音栈单 ABI jniLibs）。tag（`v*`）触发时额外自动建 GitHub Release 并挂上同一 APK（release 已存在则 `--clobber` 覆盖上传）。

### 踱坑实录（首次通绿的 6 轮迭代，后续工程师必读）

1. **workflow 顶层 `env:` 不支持 `runner` 上下文**（只认 github/inputs）→ 用 run 步骤内的 `$RUNNER_TEMP` 进程变量代替。
2. **`timeout-minutes` 是 job 级键**，写在 workflow 顶层会被直接拒（无 job 记录的裸 failure）。
3. **expo 的 properties 序列化器末行不写 `\n`**（`propertiesListToString` 只在行间补 `\n`）。prebuild 会把 `expo.inlineModules.watchedDirectories=[]` 写成末行；对 gradle.properties 任何 `>>` 追加前必须先补尾换行，否则粘连成 `[]org.gradle.caching=true`，expo-autolinking 的 `mirror-kotlin-inline-modules` 在 `projectsEvaluated` 时 `JSON.parse` 爆炸、node exit 1，而 gradle `providers.exec` 会吞掉 stderr，Actions 日志只剩退出码（三轮 CI 死于此）。
4. **@runanywhere/{core,onnx} 的 CMake 声明 `version "3.30.5"`**，runner 镜像只预装 3.22.1（其它 RN 模块都用默认），不预装则 `[CXX1300] CMake 3.30.5 not found` 秒败。workflow 里有幂等安装步骤；`yes |` 管道在 `set -o pipefail` 下会因 SIGPIPE 报 141，需 `|| true` 吸收并用 `test -d` 断言真成败。
5. **诊断手法**：gradle 步骤前的 Diagnose 步骤原样执行 autolinking mirror 命令（取参、路径与 gradle 完全一致，属性值直接读 gradle.properties），stderr 直落 Actions 日志；gradle 命令带 `--info` 可看到它构造的完整命令行——两者组合把被吞的报错撞了出来。
6. 排除项：node 版本不是问题（runner 与本机同为 v22.23.2）；bun 的 node_modules 布局也不是（本地忠实复刻成功，唯一变量是属性值被粘连）。

### webhook 通知协议

构建结束（无论成败）`always()` 回调 `secrets.HOOK_URL`：

```
POST $HOOK_URL
Authorization: Bearer $HOOK_TOKEN
X-Hook-Source: paseoanywhere-ci
Content-Type: application/json
```

payload 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `event` | string | 固定 `"apk_build"` |
| `status` | string | `job.status`：`success` / `failure` / `cancelled` |
| `run` | string | Actions run 链接（日志入口） |
| `failed_step` | string | 失败时给出卡点；成功为空串 |
| `ref` | string | 触发 ref（分支名或 tag 名） |

**`failed_step` 定位机制**：每个关键步骤成功后写 marker 文件（`$RUNNER_TEMP/markers/NN-*.done`，NN 按执行顺序编号）；通知步骤沿顺序找"最后一个已完成的 marker"，其**下一步**即死点：

- `01-bun-install` → `bun install`
- `02-expo-prebuild` → `expo prebuild`（CNG）
- `03-configure-native` → 单 ABI / heap 配置（含自检）
- `04-gradle-assemble` → `gradlew assembleDebug`（最常见死点）
- `05-upload-artifact` → artifact 上传
- `06-release` → gh release（仅 tag）

没有 marker → 死在 setup；全部完成但失败 → `after-06-release (post/cleanup step)`（缓存保存等 post 步骤）。同一信息也会写进 run 的 Job Summary 留痕。

## 本地验收（不跑原生编译）

```bash
python3 -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml && echo yaml-ok
bun run typecheck   # 必须保持绿
```
