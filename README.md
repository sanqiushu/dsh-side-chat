# Side Chat · DSH 侧栏聊天

## 1.1.2 使用

空白聊天的欢迎内容放在原生 transcript View 内，按原生容器测量的可用高度占满输入框上方的空间。输入框跟随原生 composer seat 排在底部，调整栏高或输入框高度时自动适应，不再使用绝对定位的欢迎层。发送后恢复原生 Chat transcript。

侧栏不显示主界面的「选择工作区」，自动沿用主对话创建时的工作目录。空白页使用侧栏自己的欢迎文案与原生输入框，不触发主界面导航。

此版本在创建时显式传入 provider/model 并挂载 Agent preset，修复首轮提示词组装缺少 `{{model}}` 的错误。主会话已有明确模型时沿用该模型，否则使用部署默认模型。已有错误卡片作为历史保留，不表示修复后的新一轮仍失败。

点击主会话标题旁或右侧栏开始页的 **Side Chat**，直接打开一个空白原生对话。无需填写创建表单，也不会自动发送占位消息或调用模型。

输入第一条消息后正常发送；原生输入框、模型选择、流式回复与停止功能由 DSH 提供。右上角「+ 新对话」可再开一段聊天。关闭标签不删除历史，普通会话列表也可打开这些新对话。

每段新 Side Chat 在会话头中持久记录主会话 ID，并沿用其创建时的工作目录。侧栏 Agent 的 `read_main_chat` 工具可按需读取关联主会话最近已提交的用户/助手消息。不自动复制所有主会话历史，不读取尚未提交的流式文字；最多一次返回 30 条消息，每条文本最多 6000 字符。摘要中的 live 表示主 Agent 已加载，不等同于正在执行；committedTurnOpen 是日志中的回合状态。

新聊天作为普通独立会话使用 DSH 的会话模型/权限默认设置，原生控件可调整。它与主会话共享文件，不是文件隔离环境。已有 1.0 创建的子会话保持原有行为；新的主会话关联能力适用于 1.1 创建的空白会话。若旧子会话确有父会话头，read_main_chat 也可以读取该父会话。

## 接口

- `/side-chat-new` 和 `create_blank_side_chat`：创建关联主会话的空白对话，返回 sessionId、mainSessionId、address，不导航、不发送消息。
- `read_main_chat({limit?: number})`：只读取调用者会话头中的父会话，不接受任意目标 ID。
- `send_side_chat({sessionId,prompt})`：主会话向关联的原生 Side Chat 发送消息，使用与原生输入框相同的 Session Controller prompt 路径。目标必须确实关联调用者；返回消息接收确认，回复留在侧栏日志。
- 保留旧 `/side-chat {"prompt":"...","context":"spawn"}` 与 `create_side_chat`，可创建带首条消息的 continuable 子会话；fork 模式沿用最近已完成的上下文。
- Client 注册自己的 sidechat 资源和会话槽，通过 SessionProvider 与 conversation.content Factory 复用原生聊天，不覆盖主会话。

## 安装、更新与验证

```bash
git clone https://github.com/sanqiushu/dsh-side-chat.git
```

在 DSH 中让助手通过插件管理器的 `install_bundle` 安装克隆目录的绝对路径。插件使用 DSH 提供的 Host/Client API，无需执行依赖安装或构建脚本；单独打开 JavaScript 文件不是安装方式。当前已在 DSH `0.2.1-rc.5` 上验证，其他版本的兼容性未验证。

通过 DSH 插件管理器安装本目录。替换已安装包后以安装结果为准；若返回 restart-required，需要完全重启 DSH，而非仅刷新页面。

`node --check index.js && node --check client.js && node --test test.mjs` 验证语法与 9 项服务契约/静态回归测试。浏览器视觉、焦点与实际点击流程仍需在已连接的 DSH 中核验。

图标为原创 SVG，包含中英文显示元数据。无需依赖或构建脚本；安装影响当前 profile 的所有会话。
