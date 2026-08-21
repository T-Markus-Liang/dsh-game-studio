class_name GSPlayer
extends RefCounted

# 玩家跳跃状态机。
# 故意 BUG：try_jump 在空中跳跃时没有累加 jumps_used，
# 导致 can_jump 的计数永远不会达到 max_jumps，可以无限空中跳。
# 用于 /game debug 端到端演练：tests 断言第三次跳跃（第二次空中跳）必须被拒绝。

var jumps_used: int = 0
var max_jumps: int = 2

func reset() -> void:
	jumps_used = 0

func can_jump(is_on_floor: bool) -> bool:
	if is_on_floor:
		return true
	return jumps_used < max_jumps

func try_jump(is_on_floor: bool) -> bool:
	if not can_jump(is_on_floor):
		return false
	if is_on_floor:
		jumps_used += 1
	# ← BUG：空中跳跃应同样执行 jumps_used += 1，但这里漏掉了，
	#   于是 jumps_used 永远停在 1，can_jump(false) 永远为 true（无限跳）。
	return true
