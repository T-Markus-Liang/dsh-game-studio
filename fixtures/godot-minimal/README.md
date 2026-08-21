# godot-minimal fixture

用于 dsh-game-studio `/game debug` 端到端验收演练的最小 Godot 4.3 项目（纯文本，无需真实运行 Godot）。
运行测试：`godot --headless --path . --script res://test/run_tests.gd`
预期：修复前 T3 FAIL（exit 1），修复后全部通过（exit 0）。
故意 bug 位置：`player.gd` 的 can_jump/try_jump 跳跃计数逻辑（空中跳未累加 jumps_used，导致无限跳）。
