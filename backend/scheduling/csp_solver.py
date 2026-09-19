import random
from typing import List, Dict, Tuple, Set, Optional
from dataclasses import dataclass, field
from collections import defaultdict, Counter


@dataclass
class TimeSlot:
    day: int
    period: int

    def __hash__(self):
        return hash((self.day, self.period))

    def __eq__(self, other):
        return self.day == other.day and self.period == other.period


@dataclass
class SchedulingTask:
    class_id: int
    course_id: int
    teacher_id: int
    weekly_hours: int
    preferred_room_type: str
    priority: str
    available_time_slots: List[TimeSlot]
    classroom_capacity: int


@dataclass
class UnscheduledResult:
    """一门课无法全部排入课表时的结构化结果。"""
    class_id: int
    course_id: int
    teacher_id: int
    weekly_hours: int
    scheduled_hours: int
    unscheduled_hours: int
    reason: str
    detail: str
    blocked_slots: List[Dict] = field(default_factory=list)

    def as_dict(self) -> Dict:
        return {
            'class_id': self.class_id,
            'course_id': self.course_id,
            'teacher_id': self.teacher_id,
            'weekly_hours': self.weekly_hours,
            'scheduled_hours': self.scheduled_hours,
            'unscheduled_hours': self.unscheduled_hours,
            'reason': self.reason,
            'detail': self.detail,
            'blocked_slots': self.blocked_slots,
        }


# 阻塞原因在诊断时的优先级（同等出现次数下取靠前的）
REASON_PRIORITY = [
    'teacher_unavailable',
    'classroom_capacity',
    'classroom_type',
    'teacher_occupied',
    'class_occupied',
    'classroom_occupied',
    'no_free_slot',
]

REASON_LABELS = {
    'teacher_unavailable': '教师在该时段不可用',
    'classroom_capacity': '无容量达标的教室',
    'classroom_type': '无匹配教室类型',
    'classroom_occupied': '所有合适教室此时段已被占用',
    'teacher_occupied': '教师此时段已有课',
    'class_occupied': '班级此时段已有课',
    'no_free_slot': '学期内无可用时段',
    'locked_conflict': '与已锁定课次冲突',
}


class CSPScheduler:
    def __init__(self, semester, seed: Optional[int] = None):
        self.semester = semester
        self.weekly_days = semester.weekly_days
        self.daily_periods = len(semester.daily_periods) if semester.daily_periods else 7
        self.all_slots = [
            TimeSlot(day=d + 1, period=p + 1)
            for d in range(self.weekly_days)
            for p in range(self.daily_periods)
        ]
        # 使用固定种子保证同一输入下排课结果可复现，不引入跨请求随机抖动
        self.rng = random.Random(seed if seed is not None else 42)
        self.classroom_usage = defaultdict(set)
        self.teacher_usage = defaultdict(set)
        self.class_usage = defaultdict(set)
        self.assignments: List[Dict] = []
        self.unscheduled: List[UnscheduledResult] = []

    def generate_time_slots_for_priority(self, priority: str) -> List[TimeSlot]:
        """按优先级给出候选时段的尝试顺序：主科优先上午、副科优先下午。

        使用确定性洗牌而非随机抽样：每个候选时段在一次任务中都会被完整尝试，
        既保留时段分散的软偏好，又不会因抽样而静默漏掉可行解。
        """
        morning_periods = min(4, self.daily_periods)
        morning_slots = [s for s in self.all_slots if s.period <= morning_periods]
        afternoon_slots = [s for s in self.all_slots if s.period > morning_periods]
        # 在各自时段组内做确定性洗牌，避免所有主科都挤到周一上午
        self.rng.shuffle(morning_slots)
        self.rng.shuffle(afternoon_slots)

        if priority == 'high':
            return morning_slots + afternoon_slots
        if priority == 'low':
            return afternoon_slots + morning_slots

        ordered = list(self.all_slots)
        self.rng.shuffle(ordered)
        return ordered

    def get_compatible_classrooms(
        self,
        preferred_room_type: str,
        required_capacity: int,
        classrooms_data: Dict[int, Dict]
    ) -> List[int]:
        """容量必须始终达标；类型优先匹配，匹配不到再回退到任意类型。"""
        capacity_ok = [
            cid for cid, cdata in classrooms_data.items()
            if cdata['capacity'] >= required_capacity
        ]
        preferred = [
            cid for cid in capacity_ok
            if classrooms_data[cid]['room_type'] == preferred_room_type
        ]
        if preferred:
            # 优先使用容量更贴近人数的教室，把大教室留给更需要的课
            return sorted(preferred, key=lambda cid: classrooms_data[cid]['capacity'])
        return sorted(capacity_ok, key=lambda cid: classrooms_data[cid]['capacity'])

    def has_capacity_classroom(
        self, required_capacity: int, classrooms_data: Dict[int, Dict]
    ) -> bool:
        return any(
            cdata['capacity'] >= required_capacity for cdata in classrooms_data.values()
        )

    def pick_room(
        self,
        slot: TimeSlot,
        compatible_rooms: List[int],
    ) -> Optional[int]:
        """在同一时段的教师/班级约束已通过后，挑一间未被占用的教室。"""
        for room in compatible_rooms:
            if slot not in self.classroom_usage[room]:
                return room
        return None

    def build_teacher_available(
        self, teacher_id: int, teachers_data: Dict[int, Dict]
    ) -> Set[TimeSlot]:
        slots = set()
        raw = teachers_data.get(teacher_id, {}).get('available_time_slots') or []
        for slot_dict in raw:
            slots.add(TimeSlot(day=slot_dict['day'], period=slot_dict['period']))
        return slots

    def describe_detail(
        self,
        task: SchedulingTask,
        target_hours: int,
        scheduled_hours: int,
        reason: str,
        blocked_slots: List[Dict],
        classrooms_data: Dict[int, Dict],
    ) -> str:
        label = REASON_LABELS.get(reason, reason)
        detail = (
            f"周计划 {task.weekly_hours} 节，已排 {scheduled_hours} 节，"
            f"仍缺 {target_hours - scheduled_hours} 节。主要原因：{label}。"
        )
        if reason == 'classroom_capacity':
            max_capacity = max(
                (c['capacity'] for c in classrooms_data.values()), default=0
            )
            detail += (
                f"班级 {task.class_id} 需要可容纳 {task.classroom_capacity} "
                f"人的教室，当前最大容量仅 {max_capacity}。"
            )
        samples = blocked_slots[:3]
        if samples:
            positions = '、'.join(
                f"周{s['day']}第{s['period']}节（{REASON_LABELS.get(s['reason'], s['reason'])}）"
                for s in samples
            )
            detail += f"例如：{positions}。"
        return detail

    def _register_locked_entries(self, locked_entries: List[Dict]) -> List[Dict]:
        registered = []
        for entry in locked_entries:
            slot = TimeSlot(day=entry['day_of_week'], period=entry['period'])
            # 锁定课次原样保留：它们占用教师、教室、班级三类资源
            self.classroom_usage[entry['classroom_id']].add(slot)
            self.teacher_usage[entry['teacher_id']].add(slot)
            self.class_usage[entry['class_id']].add(slot)
            self.assignments.append(entry)
            registered.append(entry)
        return registered

    def _locked_hours_for_task(self, task: SchedulingTask, locked_entries: List[Dict]) -> int:
        return sum(
            1 for entry in locked_entries
            if entry['class_id'] == task.class_id
            and entry.get('course_id') == task.course_id
            and entry['teacher_id'] == task.teacher_id
        )

    def schedule(
        self,
        tasks: List[SchedulingTask],
        classrooms_data: Dict[int, Dict],
        teachers_data: Dict[int, Dict],
        locked_entries: Optional[List[Dict]] = None
    ) -> Tuple[List[Dict], List[Dict]]:
        self.assignments = []
        self.unscheduled = []
        self.classroom_usage.clear()
        self.teacher_usage.clear()
        self.class_usage.clear()

        locked_entries = locked_entries or []
        self._register_locked_entries(locked_entries)

        priority_order = {'high': 0, 'medium': 1, 'low': 2}
        sorted_tasks = sorted(
            tasks,
            key=lambda t: (priority_order.get(t.priority, 1), -t.weekly_hours)
        )

        for task in sorted_tasks:
            teacher_available = self.build_teacher_available(
                task.teacher_id, teachers_data
            )

            # 已锁定的同班级同课程课次计入课时，避免重复排
            locked_hours = self._locked_hours_for_task(task, locked_entries)
            target_hours = max(0, task.weekly_hours - locked_hours)

            if target_hours == 0:
                continue

            if not self.all_slots:
                self.unscheduled.append(UnscheduledResult(
                    class_id=task.class_id,
                    course_id=task.course_id,
                    teacher_id=task.teacher_id,
                    weekly_hours=task.weekly_hours,
                    scheduled_hours=locked_hours,
                    unscheduled_hours=target_hours,
                    reason='no_free_slot',
                    detail=self.describe_detail(
                        task, task.weekly_hours, locked_hours,
                        'no_free_slot', [], classrooms_data
                    ),
                ))
                continue

            # 容量不达标属于硬约束：任何时段都无法解决，立即记录原因
            if not self.has_capacity_classroom(task.classroom_capacity, classrooms_data):
                blocked = [
                    {'day': s.day, 'period': s.period, 'reason': 'classroom_capacity'}
                    for s in self.generate_time_slots_for_priority(task.priority)
                ]
                self.unscheduled.append(UnscheduledResult(
                    class_id=task.class_id,
                    course_id=task.course_id,
                    teacher_id=task.teacher_id,
                    weekly_hours=task.weekly_hours,
                    scheduled_hours=locked_hours,
                    unscheduled_hours=target_hours,
                    reason='classroom_capacity',
                    detail=self.describe_detail(
                        task, task.weekly_hours, locked_hours,
                        'classroom_capacity', blocked, classrooms_data
                    ),
                    blocked_slots=blocked,
                ))
                continue

            compatible_rooms = self.get_compatible_classrooms(
                task.preferred_room_type,
                task.classroom_capacity,
                classrooms_data
            )

            candidate_slots = self.generate_time_slots_for_priority(task.priority)
            used_slots_for_task: Set[TimeSlot] = set()
            blocked_slots: List[Dict] = []
            scheduled_hours = 0

            # 完整遍历候选时段：只要教师/教室/班级同时空闲就落位，
            # 不再依赖“随机尝试 500 次”，避免资源紧张时静默丢课
            for slot in candidate_slots:
                if scheduled_hours >= target_hours:
                    break
                if slot in used_slots_for_task:
                    continue
                used_slots_for_task.add(slot)

                if teacher_available and slot not in teacher_available:
                    blocked_slots.append({
                        'day': slot.day, 'period': slot.period,
                        'reason': 'teacher_unavailable'
                    })
                    continue
                if slot in self.teacher_usage[task.teacher_id]:
                    blocked_slots.append({
                        'day': slot.day, 'period': slot.period,
                        'reason': 'teacher_occupied'
                    })
                    continue
                if slot in self.class_usage[task.class_id]:
                    blocked_slots.append({
                        'day': slot.day, 'period': slot.period,
                        'reason': 'class_occupied'
                    })
                    continue

                room = self.pick_room(slot, compatible_rooms)
                if room is None:
                    blocked_slots.append({
                        'day': slot.day, 'period': slot.period,
                        'reason': 'classroom_occupied'
                    })
                    continue

                self.classroom_usage[room].add(slot)
                self.teacher_usage[task.teacher_id].add(slot)
                self.class_usage[task.class_id].add(slot)

                self.assignments.append({
                    'semester_id': self.semester.id,
                    'class_id': task.class_id,
                    'course_id': task.course_id,
                    'teacher_id': task.teacher_id,
                    'classroom_id': room,
                    'day_of_week': slot.day,
                    'period': slot.period,
                    'is_locked': False
                })
                scheduled_hours += 1

            total_scheduled = locked_hours + scheduled_hours
            if scheduled_hours < target_hours:
                # 取出现次数最多的阻塞原因；次数相同时按 REASON_PRIORITY 取最靠前的
                reason_counts = Counter(s['reason'] for s in blocked_slots)
                if reason_counts:
                    max_count = max(reason_counts.values())
                    reason = next(
                        r for r in REASON_PRIORITY
                        if reason_counts.get(r, 0) == max_count
                    )
                else:
                    reason = 'no_free_slot'

                self.unscheduled.append(UnscheduledResult(
                    class_id=task.class_id,
                    course_id=task.course_id,
                    teacher_id=task.teacher_id,
                    weekly_hours=task.weekly_hours,
                    scheduled_hours=total_scheduled,
                    unscheduled_hours=task.weekly_hours - total_scheduled,
                    reason=reason,
                    detail=self.describe_detail(
                        task, task.weekly_hours, total_scheduled,
                        reason, blocked_slots, classrooms_data
                    ),
                    blocked_slots=blocked_slots,
                ))

        return self.assignments, [u.as_dict() for u in self.unscheduled]


class ConflictDetector:
    def detect_conflicts(self, entries: List[Dict]) -> List[Dict]:
        conflicts = []
        by_slot = defaultdict(list)

        for entry in entries:
            key = (entry['day_of_week'], entry['period'])
            by_slot[key].append(entry)

        for (day, period), slot_entries in by_slot.items():
            teacher_map = defaultdict(list)
            classroom_map = defaultdict(list)
            class_map = defaultdict(list)

            for entry in slot_entries:
                teacher_map[entry['teacher_id']].append(entry)
                classroom_map[entry['classroom_id']].append(entry)
                class_map[entry['class_id']].append(entry)

            for tid, t_entries in teacher_map.items():
                if len(t_entries) > 1:
                    locked = any(e.get('is_locked') for e in t_entries)
                    conflicts.append({
                        'conflict_type': 'teacher',
                        'day_of_week': day,
                        'period': period,
                        'involved_entries': [e.get('id') for e in t_entries if e.get('id')],
                        'message': (
                            f"教师 {tid} 同一时间有 {len(t_entries)} 门课"
                            f"{'（含锁定课次，请人工调整）' if locked else ''}"
                        )
                    })

            for cid, c_entries in classroom_map.items():
                if len(c_entries) > 1:
                    conflicts.append({
                        'conflict_type': 'classroom',
                        'day_of_week': day,
                        'period': period,
                        'involved_entries': [e.get('id') for e in c_entries if e.get('id')],
                        'message': f"教室 {cid} 同一时间有 {len(c_entries)} 门课"
                    })

            for clid, cl_entries in class_map.items():
                if len(cl_entries) > 1:
                    conflicts.append({
                        'conflict_type': 'class',
                        'day_of_week': day,
                        'period': period,
                        'involved_entries': [e.get('id') for e in cl_entries if e.get('id')],
                        'message': f"班级 {clid} 同一时间有 {len(cl_entries)} 门课"
                    })

        return conflicts
