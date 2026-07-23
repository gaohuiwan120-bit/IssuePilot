# MLPilot vs Pi Upstream

MLPilot does NOT fork Pi core.

| Feature | Pi | MLPilot |
|---|---|---|
| Agent loop | pi-agent-core | reused |
| ML tools | none | ml-tools extension |
| Workflow FSM | none | workflow-controller |
| Permission gate | example only | production extension |
| Git checkpoint | example only | production extension |
| Eval harness | none | eval/offline + eval/e2e |