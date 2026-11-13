# Agent Note: 通过工具路由视频生成

Status: implemented

[English](2026-10-19-video-generation-routing.md) | 中文

## 问题

持久化会话将 `grok-imagine-video-1.5` 选为对话模型，经 chat completions 收到 `400 INVALID_REQUEST` 或缺少 `finish_reason` 的错误。同一会话改选 `grok-4.7` 后，通过 `generate_video` 保存了六秒 MP4。视频输出能力不代表支持聊天补全。

## 决策

声明 `video` 输出的模型是工具目标。对话模型列表排除这些模型，对话执行器也拒绝直接选择，并提示调用方选择对话模型、使用 `generate_video`。仅过滤列表无法保护已经持有模型 id 的调用方。

视频执行在工具开始时捕获当前 profile 和附件存储。它解析目标模型的端点和提供方认证，保留自定义请求头，并且仅向 API 同源地址发送下载凭据。提供方 JSON 在使用前经过校验。提交、可取消的轮询和下载共用一个总截止时间；提供方配置负责轮询间隔和超时。

## 曾考虑的替代方案

- 将视频输出视为对话能力：否决，因为生成 API 返回异步任务，而非聊天补全数据块。
- 仅修复选择器：否决，因为已保存的选择和直接调用方可以绕过它。
- 为返回的所有下载 URL 发送认证：否决，因为提供方响应可以指向其他来源，造成凭据泄露。

## 后果

对话模型可以调用视频生成，无需将视频模型用于对话。执行会等待生成及附件存储，并受取消和超时约束。此决策不增加播放或产物预览界面。

## 验证

可选的[真实提供方测试](../../../../packages/llm/llm-pi-ai/tests/video.e2e.ts)以一秒、480p 的生成请求通过验证。测试下载结果，从本地附件存储读回，并核对编码字节数和 MP4 签名。该付费测试禁用自动重试。

针对性运行通过：[协议测试](../../../../packages/llm/llm-pi-ai/tests/video.spec.ts)覆盖生成、校验、取消、超时和下载认证；[路由测试](../../../../packages/llm/llm-pi-ai/tests/video-routing.spec.ts)和[适配器测试](../../../../packages/llm/llm-pi-ai/tests/adapter.spec.ts)覆盖视频目标选择和对话拒绝。[配置测试](../../../../packages/llm/llm-pi-ai/tests/config.spec.ts)、[目录测试](../../../../packages/llm/llm-pi-ai/tests/catalog.spec.ts)和[动态设置测试](../../../../packages/llm/llm-pi-ai/tests/dynamic-config.spec.ts)覆盖默认值、上限、输出声明和按操作读取设置。
