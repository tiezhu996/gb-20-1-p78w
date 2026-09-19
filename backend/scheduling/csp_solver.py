import random
from typing import List, Dict, Tuple, Set, Optional
from dataclasses import dataclass, field
from collections import defaultdict


@dataclass
class TimeSlot:
    day: int
    period: int

    def __hash__(self):
        return hash((self.day, self.period))

    def __eq__(self, other):
        if not isinstance(other, TimeSlot):
            return False
        return self.day == other.day and self.period == other.period

    def __lt__(self, other):
        return (self.day, self.period) < (other.day, other.period)

    def as_dict(self) -> Dict:
        return {'day': self.day, 'period': self.period}


@dataclass
class SchedulingTask:
    class_id: int
    course_id: int
    teacher_id: int
    weekly_hours: int
    preferred_room_type: str
    priority: str
    available_time_slots: List[TimeSlot] = field(default_factory=list)
    classroom_capacity: int = 40
    class_course_id: Optional[int] = None
    # 该任务已存在的锁定课时数，自动排课时必须保留并计入课时需求
    locked_hours: int = 0


class CSPScheduler:
    """
    基于约束满足的贪心排课器。

    硬约束（任何情况下都不得违反）：
    - 同一时间一名教师只能上一门课
    - 同一时间一间教室只能容纳一门课
    - 同一时间一个班级只能上一门课
    - 教师只能在其可用时间段内授课
    - 教室容量必须容纳班级人数

    已锁定课次视为不可移动的预置占用；无法排入的课时必须返回
    unscheduled 结果并附带具体原因，绝不允许静默丢弃。
    """

    def __init__(self, semester):
        self.semester = semester
        self.weekly_days = semester.weekly_days
        self.daily_periods = len(semester.daily_periods) if semester.daily_periods else 7
        self.all_slots = sorted([
            TimeSlot(day=d + 1, period=p + 1)
            for d in range(self.weekly_days)
            for p in range(self.daily_periods)
        ])
        # 全部占用（锁定 + 自动排课）
        self.classroom_usage: Dict[int, Set[TimeSlot]] = defaultdict(set)
        self.teacher_usage: Dict[int, Set[TimeSlot]] = defaultdict(set)
        self.class_usage: Dict[int, Set[TimeSlot]] = defaultdict(set)
        # 仅锁定课次的占用，用于区分“被锁定课次挡住”与“被其他自动课程挡住”
        self.locked_classroom_usage: Dict[int, Set[TimeSlot]] = defaultdict(set)
        self.locked_teacher_usage: Dict[int, Set[TimeSlot]] = defaultdict(set)
        self.locked_class_usage: Dict[int, Set[TimeSlot]] = defaultdict(set)
        self.assignments: List[Dict] = []
        self.unscheduled: List[Dict] = []

    def generate_time_slots_for_priority(self, priority: str) -> List[TimeSlot]:
        morning_periods = min(4, self.daily_periods)
        morning_slots = [s for s in self.all_slots if s.period <= morning_periods]
        afternoon_slots = [s for s in self.all_slots if s.period > morning_periods]

        if priority == 'high':
            return morning_slots + afternoon_slots
        if priority == 'low':
            return afternoon_slots + morning_slots
        return list(self.all_slots)

    def is_available(
        self,
        time_slot: TimeSlot,
        teacher_id: int,
        class_id: int,
        classroom_id: int,
        teacher_available_slots: Set[TimeSlot]
    ) -> bool:
        if teacher_available_slots and time_slot not in teacher_available_slots:
            return False
        if time_slot in self.teacher_usage[teacher_id]:
            return False
        if time_slot in self.class_usage[class_id]:
            return False
        if time_slot in self.classroom_usage[classroom_id]:
            return False
        return True

    def get_compatible_classrooms(
        self,
        preferred_room_type: str,
        required_capacity: int,
        classrooms_data: Dict[int, Dict]
    ) -> Tuple[List[int], bool]:
        """返回（可用教室列表, 是否存在容量不足的问题）。优先返回类型匹配的教室。"""
        capacity_ok = [
            cid for cid, cdata in classrooms_data.items()
            if cdata['capacity'] >= required_capacity
        ]
        preferred = [
            cid for cid in capacity_ok
            if classrooms_data[cid]['room_type'] == preferred_room_type
        ]
        any_classroom = bool(classrooms_data)
        capacity_shortage = any_classroom and not capacity_ok
        return preferred + [c for c in capacity_ok if c not in preferred], capacity_shortage

    def _teacher_available_set(self, task: SchedulingTask, teachers_data: Dict[int, Dict]) -> Set[TimeSlot]:
        explicit = set(task.available_time_slots or [])
        stored = teachers_data.get(task.teacher_id, {}).get('available_time_slots') or []
        for slot_dict in stored:
            explicit.add(TimeSlot(day=slot_dict['day'], period=slot_dict['period']))
        return explicit

    def _ordered_slots(self, task: SchedulingTask) -> List[TimeSlot]:
        """
        有序枚举候选时间段：保证每个时间段都会被检查（不会随机漏排），
        同时用按任务种子生成的伪随机顺序打散拥挤度，输出可复现。
        """
        ordered = self.generate_time_slots_for_priority(task.priority)
        seed = f"{self.semester.id}-{task.class_id}-{task.course_id}-{task.teacher_id}"
        rng = random.Random(seed)
        rng.shuffle(ordered)
        # 高优先级仍尽量靠前上午：以上午/下午分组后组内洗牌
        morning_periods = min(4, self.daily_periods)
        morning = [s for s in ordered if s.period <= morning_periods]
        afternoon = [s for s in ordered if s.period > morning_periods]
        if task.priority == 'high':
            return morning + afternoon
        if task.priority == 'low':
            return afternoon + morning
        return ordered

    def _diagnose_failure(
        self,
        task: SchedulingTask,
        candidate_slots: List[TimeSlot],
        compatible_rooms: List[int],
        teacher_available: Set[TimeSlot],
        capacity_shortage: bool,
        remaining: int,
        self_slots: Set[TimeSlot]
    ) -> Dict:
        """逐个时间段分析排不进去的根因，给出具体阻塞原因。

        self_slots 中是本任务自己已经占掉的时间段，统计时不计为“被别人挡住”，
        否则一个需要 40 课时但只有 35 个格子的任务会被误判成教师/班级忙碌。
        """
        reasons = defaultdict(int)
        blocking_slots = []
        locked_hit = {'teacher': 0, 'class': 0, 'classroom': 0}

        for slot in candidate_slots:
            if slot in self_slots:
                reasons['self_assigned'] += 1
                continue

            slot_reasons = []
            if teacher_available and slot not in teacher_available:
                slot_reasons.append('teacher_unavailable')

            if slot in self.teacher_usage[task.teacher_id]:
                slot_reasons.append('teacher_busy')
                if slot in self.locked_teacher_usage[task.teacher_id]:
                    locked_hit['teacher'] += 1
            if slot in self.class_usage[task.class_id]:
                slot_reasons.append('class_busy')
                if slot in self.locked_class_usage[task.class_id]:
                    locked_hit['class'] += 1

            room_free = None
            for room in compatible_rooms:
                if slot not in self.classroom_usage[room]:
                    room_free = room
                    break
            if room_free is None:
                slot_reasons.append('classroom_busy')
                for room in compatible_rooms:
                    if slot in self.locked_classroom_usage[room]:
                        locked_hit['classroom'] += 1
                        break

            if not slot_reasons:
                # 理论上可排（不应到达这里），保守归为综合不足
                slot_reasons.append('no_slots')

            for reason in slot_reasons:
                reasons[reason] += 1
            if len(blocking_slots) < 8:
                blocking_slots.append({
                    'day_of_week': slot.day,
                    'period': slot.period,
                    'reasons': slot_reasons
                })

        total = len(candidate_slots)
        self_assigned = reasons.get('self_assigned', 0)
        unavail = reasons.get('teacher_unavailable', 0)
        teacher_busy = reasons.get('teacher_busy', 0)
        class_busy = reasons.get('class_busy', 0)
        room_busy = reasons.get('classroom_busy', 0)

        if not compatible_rooms:
            code = 'capacity_shortage' if capacity_shortage else 'no_classroom'
        elif self_assigned == total:
            # 每个格子都已被本课程占用仍不够：课表网格容量不足
            code = 'no_slots'
        elif teacher_available and (total - unavail) < task.weekly_hours - task.locked_hours:
            # 教师可用时间段总数本身就少于课程需求
            code = 'teacher_unavailable'
        elif teacher_busy and teacher_busy >= class_busy and teacher_busy >= room_busy:
            code = 'teacher_busy'
        elif class_busy and class_busy >= room_busy:
            code = 'class_busy'
        elif room_busy:
            code = 'classroom_busy'
        else:
            code = 'no_slots'

        locked_parts = []
        if locked_hit['teacher']:
            locked_parts.append(f"教师有 {locked_hit['teacher']} 个时间段被锁定课次占用")
        if locked_hit['class']:
            locked_parts.append(f"班级有 {locked_hit['class']} 个时间段被锁定课次占用")
        if locked_hit['classroom']:
            locked_parts.append(f"教室有 {locked_hit['classroom']} 个时间段被锁定课次占用")

        return {
            'reason_code': code,
            'blocking_slots': blocking_slots,
            'locked_block_detail': '；'.join(locked_parts)
        }

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
        self.locked_classroom_usage.clear()
        self.locked_teacher_usage.clear()
        self.locked_class_usage.clear()

        # 1. 先装载已锁定课次：锁定课次必须保留，且占用教师/教室/班级资源
        if locked_entries:
            for entry in locked_entries:
                slot = TimeSlot(day=entry['day_of_week'], period=entry['period'])
                self.classroom_usage[entry['classroom_id']].add(slot)
                self.teacher_usage[entry['teacher_id']].add(slot)
                self.class_usage[entry['class_id']].add(slot)
                self.locked_classroom_usage[entry['classroom_id']].add(slot)
                self.locked_teacher_usage[entry['teacher_id']].add(slot)
                self.locked_class_usage[entry['class_id']].add(slot)
                self.assignments.append(entry)

        # 2. 按优先级、周课时排序依次排课
        priority_order = {'high': 0, 'medium': 1, 'low': 2}
        sorted_tasks = sorted(
            tasks,
            key=lambda t: (priority_order.get(t.priority, 1), -t.weekly_hours, t.class_id, t.course_id)
        )

        for task in sorted_tasks:
            teacher_available = self._teacher_available_set(task, teachers_data)
            compatible_rooms, capacity_shortage = self.get_compatible_classrooms(
                task.preferred_room_type,
                task.classroom_capacity,
                classrooms_data
            )

            # 锁定课时已经满足一部分周课时需求，只补排差额
            need = max(0, task.weekly_hours - task.locked_hours)
            hours_assigned = 0
            self_slots: Set[TimeSlot] = set()

            if compatible_rooms and need > 0:
                candidate_slots = self._ordered_slots(task)
                for slot in candidate_slots:
                    if hours_assigned >= need:
                        break
                    for room in compatible_rooms:
                        if self.is_available(
                            slot, task.teacher_id, task.class_id, room, teacher_available
                        ):
                            self.classroom_usage[room].add(slot)
                            self.teacher_usage[task.teacher_id].add(slot)
                            self.class_usage[task.class_id].add(slot)
                            self_slots.add(slot)
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
                            hours_assigned += 1
                            break

            # 3. 未排满的任务必须记录具体原因，不允许静默丢课
            if hours_assigned < need:
                candidate_slots = self._ordered_slots(task)
                diagnosis = self._diagnose_failure(
                    task, candidate_slots, compatible_rooms, teacher_available,
                    capacity_shortage, need - hours_assigned, self_slots
                )
                self.unscheduled.append({
                    'class_course_id': task.class_course_id,
                    'class_id': task.class_id,
                    'course_id': task.course_id,
                    'teacher_id': task.teacher_id,
                    'requested_hours': task.weekly_hours,
                    'locked_hours': task.locked_hours,
                    'scheduled_hours': hours_assigned,
                    'unscheduled_hours': need - hours_assigned,
                    'reason_code': diagnosis['reason_code'],
                    'reason_detail': self._build_reason_message(task, diagnosis, hours_assigned, need),
                    'blocking_slots': diagnosis['blocking_slots']
                })

        return self.assignments, self.unscheduled

    def _build_reason_message(self, task: SchedulingTask, diagnosis: Dict, hours_assigned: int, need: int) -> str:
        code = diagnosis['reason_code']
        reason_map = {
            'no_classroom': '没有任何教室可用（无启用教室）',
            'capacity_shortage': f"所有教室容量都小于班级人数 {task.classroom_capacity} 人",
            'teacher_unavailable': '教师标记的可用时间段内无法排入该课程',
            'class_busy': '班级在所有候选时间段均已有课程（含锁定课次）',
            'teacher_busy': '教师在所有候选时间段均已有课程（含锁定课次）',
            'classroom_busy': f"满足“{task.preferred_room_type}”类型与容量要求的教室在候选时间段均被占用（含锁定课次）",
            'no_slots': '教师、班级、教室资源综合冲突，找不到可排入的时间段',
        }
        message = (
            f"课程要求每周 {task.weekly_hours} 课时，"
            f"其中锁定保留 {task.locked_hours} 课时，"
            f"本次新排 {hours_assigned}/{need} 课时。{reason_map.get(code, '资源不足')}"
        )
        if diagnosis.get('locked_block_detail'):
            message += f"。锁定占用情况：{diagnosis['locked_block_detail']}"
        return message


class ConflictDetector:
    """检测已排课表中的教师/教室/班级三重占用，并附带资源 ID 便于前端定位。"""

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
                    conflicts.append({
                        'conflict_type': 'teacher',
                        'day_of_week': day,
                        'period': period,
                        'involved_entries': [e.get('id') for e in t_entries if e.get('id')],
                        'related_teacher_id': tid,
                        'related_classroom_id': None,
                        'related_class_id': None,
                        'locked_involved': any(e.get('is_locked') for e in t_entries),
                        'message': f"教师（ID:{tid}）在周{day}第{period}节同时有 {len(t_entries)} 门课"
                    })

            for cid, c_entries in classroom_map.items():
                if len(c_entries) > 1:
                    conflicts.append({
                        'conflict_type': 'classroom',
                        'day_of_week': day,
                        'period': period,
                        'involved_entries': [e.get('id') for e in c_entries if e.get('id')],
                        'related_teacher_id': None,
                        'related_classroom_id': cid,
                        'related_class_id': None,
                        'locked_involved': any(e.get('is_locked') for e in c_entries),
                        'message': f"教室（ID:{cid}）在周{day}第{period}节同时安排 {len(c_entries)} 门课"
                    })

            for clid, cl_entries in class_map.items():
                if len(cl_entries) > 1:
                    conflicts.append({
                        'conflict_type': 'class',
                        'day_of_week': day,
                        'period': period,
                        'involved_entries': [e.get('id') for e in cl_entries if e.get('id')],
                        'related_teacher_id': None,
                        'related_classroom_id': None,
                        'related_class_id': clid,
                        'locked_involved': any(e.get('is_locked') for e in cl_entries),
                        'message': f"班级（ID:{clid}）在周{day}第{period}节同时有 {len(cl_entries)} 门课"
                    })

        return conflicts
