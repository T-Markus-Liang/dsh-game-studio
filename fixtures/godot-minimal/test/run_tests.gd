extends SceneTree

# GS Fixture 测试：验证玩家跳跃状态机。
# 预期失败（修复前）：T3 third jump should be rejected。

func _init() -> void:
	var failures := 0
	var player := load("res://player.gd").new()

	# T1 地面首跳成功
	player.reset()
	if not player.try_jump(true):
		failures += 1
		print("FAIL T1 ground jump should succeed")

	# T2 空中可跳一次（二段跳）
	player.reset()
	player.try_jump(true)
	if not player.try_jump(false):
		failures += 1
		print("FAIL T2 air jump (double jump) should succeed")

	# T3 达到上限后不能再跳 —— 修复前这里会 FAIL（无限跳 bug）
	player.reset()
	player.try_jump(true)
	player.try_jump(false)
	if player.try_jump(false):
		failures += 1
		print("FAIL T3 third jump should be rejected (double-jump bug present)")

	if failures == 0:
		print("TESTS PASSED (%d failures)" % failures)
		quit(0)
	else:
		print("TESTS FAILED (%d failures)" % failures)
		quit(1)
