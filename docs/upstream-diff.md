# MLPilot vs Pi Upstream

> **历史文档：** Phase 0 / 早期对比笔记，**不是**现行安装说明。现行依赖与运行方式见 [`README.md`](../README.md)。IssuePilot 不 fork Pi core；运行时通过 npm 消费 `@earendil-works/pi-coding-agent`。

MLPilot does NOT fork Pi core.

| Feature | Pi | MLPilot |
|---|---|---|
| Agent loop | pi-agent-core | reused |
| ML tools | none | ml-tools extension |
| Workflow FSM | none | workflow-controller |
| Permission gate | example only | production extension |
| Git checkpoint | example only | production extension |
| Eval harness | none | eval/offline + eval/e2e |