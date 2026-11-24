# 餐厅设计工作台

[English](README.md) | 中文

## 概要

在同一页使用二维平面、Three.js 场景和 Harness 对话查看并调整餐厅方案。可以建立家具组合、预览四人桌替换、查看冲突，以及应用或撤销修改。

[工作台开发提案](../.agents/notes/proposed/feature/2026-10-28-restaurant-design-workbench.zh.md) 说明查看器接入、餐厅规则和方案交付的下一阶段里程碑。

## 目录

- [准备项目](#prepare-a-project)
- [打开工作台](#open-the-workspace)
- [编辑布置](#edit-a-layout)
- [限制](#limitations)
- [验证](#verification)

<a id="prepare-a-project"></a>

## 准备项目

准备项目之前，从仓库根目录安装依赖。构建后的 Harness 加载餐厅插件时，会使用私有 `restaurant-design` 工作区包声明的依赖。指定原始离线 HTML 和独立的可写项目目录：

```powershell
node --import tsx/esm restaurant-design/setup.ts --source "C:/path/restaurant.html" --workspace .artifacts/restaurant-design
```

准备操作只提取 JSON 字面值，不执行文档代码；它保留查看器副本，并创建 `project.json`、`cordis.yml` 和 `tools.patch.yml`。重复准备会保留已接受的项目修改；其他源文件需要单独的工作目录。项目坐标单位为毫米，导入尺寸仍是待核实的设计资料。

<a id="open-the-workspace"></a>

## 打开工作台

通过现有 Web profile 启动：

```powershell
node --import tsx/esm apps/cli/src/bin.ts --profile web --patch .artifacts/restaurant-design/cordis.yml -- --no-open --port 0
```

先打开终端打印的启动链接完成认证，再打开同一站点的 `/api/restaurant.workbench`。在 Harness 面板选择工作区或已有对话。二维平面用于编辑，三维面板同步跟随并支持相机操作，独立查看器仍可通过 `/api/restaurant.page` 打开。纯工具 overlay 可用于 headless profile。

对于已准备的本地试用，执行 `pwsh -File restaurant-design/start.ps1` 会使用独立的工作目录，并在相应文件存在时加载模型和浏览器目录选择器 overlay。按 Ctrl+C 停止。工作目录中的模型设置不会替换全局设置文件。

<a id="edit-a-layout"></a>

## 编辑布置

在查看器中点选家具，追加选中构件或输入 ID，确认成员后建立命名组合。使用工作台控件，或让助手读取餐厅、按指定距离移动所选构件、检查冲突或撤销修改。选中已分组的成员会扩展为整个组合。组合支持刚性平移；独立旋转、改尺寸或删除成员前需要撤销分组。

要预览四人桌替换，选中一个包含一张餐桌（矩形或圆形）和两把椅子的组合。源方案中的家具若尚未分组，先建立组合。等选择同步完成后，对助手说“把选中的这组换成四人桌，先让我看预览”。预览使用矩形桌布置模板，保持桌子中心和朝向，并按当前方案检查家具占地和拉椅空间。

在二维和三维视图查看候选布置，核对冲突清单，再从二维面板应用或取消。存在冲突或版本过期时，系统会阻止应用。确认替换保存为一个版本，撤销可恢复原桌、椅子及组合成员。

新增或加重重叠时，系统拒绝整次修改。原始方案已有的重叠保留为基线问题。被拒绝的修改显示冲突对象，并恢复已接受的布置。两个视图跟随服务端版本，原工具栏的撤销、重做使用服务端历史。导出的项目 JSON 包含建筑底图、家具、组合和禁占区规则；私有撤销历史留在工作项目文件中。

页面在不透明来源的隔离框架内运行提供的查看器。可信父页面仅通过现有认证 Connection 接受规定的餐厅操作。查看器无法读取 Harness 凭据或访问任意 Host API。

<a id="limitations"></a>

## 限制

一个 Harness 进程拥有一个项目文件，不能让 Web 和 headless 同时写同一文件。持久化保留完整版本快照，适用于本地试用。适配器依赖所提供查看器的声明和编辑锚点，不是通用 HTML 或 CAD 导入器。

检查覆盖旋转家具占地、墙窗矩形、保守门扇开启包络、手动配置的凸多边形禁占区和导入的矩形范围。四人桌模板为候选餐椅设定拉出余量，其他家具仍按占地检查。原方案含有重叠和重复对象，需要设计复核。建筑底图已锁定。实测房间范围、疏散审查、法定容纳人数和施工图属于其他设计环节。

<a id="verification"></a>

## 验证

```powershell
node node_modules/vitest/vitest.mjs run --config restaurant-design/vitest.config.ts
node node_modules/typescript/bin/tsc -p restaurant-design/tsconfig.check.json
```

局部类型检查通过项目引用使用仓库中已构建的依赖声明。测试覆盖持久编辑、冲突拒绝、组合平移、版本竞态、隔离框架、浏览器回滚、真实 Loader 工具注册、卸载以及重复准备项目。在实际 Web profile 中的浏览器验证覆盖建组、移动 300 mm、Three.js 显示、刷新、撤销、旧版本拒绝和完整导出。真实 Claude Opus 5.5 对话已通过工具读取和移动构件、更新查看器，并在第二轮对话中撤销恢复。

[无密钥 headless 场景](../snapshots/session/restaurant-layout/snapshot.yml) 使用只有两个构件的合成餐厅回放读取、移动和撤销，并独立比较完整的最终项目文件。执行命令为 `$env:DSH_SNAPSHOT='replay'; node node_modules/vitest/vitest.mjs run --config vitest.snapshot.config.ts -t restaurant-layout`。

[替换场景](../snapshots/session/restaurant-replacement/snapshot.yml) 验证工具生成预览时保留原保存项目。浏览器测试使用现有 Harness 输入框，验证两个视图显示同一预览、确认只应用一次，且撤销恢复原组合。
