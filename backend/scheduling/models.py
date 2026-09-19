from django.db import models
from core.models import Classroom, Teacher, Class, Course, Semester


class ClassCourse(models.Model):
    class_id = models.ForeignKey(Class, on_delete=models.CASCADE, related_name='course_assignments')
    course = models.ForeignKey(Course, on_delete=models.CASCADE)
    teacher = models.ForeignKey(Teacher, on_delete=models.CASCADE)
    semester = models.ForeignKey(Semester, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ['class_id', 'course', 'teacher', 'semester']
        ordering = ['semester', 'class_id']

    def __str__(self):
        return f"{self.class_id} - {self.course} ({self.teacher})"


class ScheduleEntry(models.Model):
    semester = models.ForeignKey(Semester, on_delete=models.CASCADE)
    class_id = models.ForeignKey(Class, on_delete=models.CASCADE, related_name='schedules')
    course = models.ForeignKey(Course, on_delete=models.CASCADE)
    teacher = models.ForeignKey(Teacher, on_delete=models.CASCADE)
    classroom = models.ForeignKey(Classroom, on_delete=models.CASCADE)
    day_of_week = models.IntegerField(help_text='1-5 代表周一到周五')
    period = models.IntegerField(help_text='第几节课')
    is_locked = models.BooleanField(default=False, help_text='锁定后不参与自动重排')
    is_conflict = models.BooleanField(default=False)
    conflict_type = models.CharField(max_length=50, blank=True)
    original_teacher = models.ForeignKey(
        Teacher, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='substitute_for',
        help_text='如果是代课，记录原教师'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['semester', 'day_of_week', 'period']

    def __str__(self):
        return (f"{self.class_id} - {self.course} @ "
                f"周{self.day_of_week}第{self.period}节")


class UnscheduledCourse(models.Model):
    """自动排课后仍有剩余课时无法安排的课程，必须逐门记录具体原因。"""
    REASON_CHOICES = [
        ('teacher_unavailable', '教师可用时间不足'),
        ('classroom_capacity', '教室容量不足'),
        ('classroom_type', '无匹配教室类型'),
        ('classroom_occupied', '教室时段全部被占用'),
        ('teacher_occupied', '教师时段被占用'),
        ('class_occupied', '班级时段被占用'),
        ('no_free_slot', '学期内无可用时段'),
        ('locked_conflict', '与锁定课次冲突'),
    ]

    semester = models.ForeignKey(
        Semester, on_delete=models.CASCADE, related_name='unscheduled_courses'
    )
    class_id = models.ForeignKey(
        Class, on_delete=models.CASCADE, related_name='unscheduled_records'
    )
    course = models.ForeignKey(
        Course, on_delete=models.CASCADE, related_name='unscheduled_records'
    )
    teacher = models.ForeignKey(
        Teacher, on_delete=models.CASCADE, related_name='unscheduled_records'
    )
    weekly_hours = models.IntegerField(help_text='每周应排课时数')
    scheduled_hours = models.IntegerField(default=0, help_text='其中已排（含锁定）课时数')
    unscheduled_hours = models.IntegerField(default=0, help_text='未能安排的课时数')
    reason = models.CharField(max_length=30, choices=REASON_CHOICES)
    detail = models.TextField(blank=True, default='', help_text='未排原因的人类可读说明')
    blocked_slots = models.JSONField(
        default=list, blank=True, help_text='逐个候选时段的阻塞原因'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['semester', 'class_id', 'course']

    def __str__(self):
        return (f"{self.class_id} - {self.course} 未排{self.unscheduled_hours}节"
                f"（{self.get_reason_display()}）")


class Conflict(models.Model):
    CONFLICT_TYPES = [
        ('teacher', '教师冲突'),
        ('classroom', '教室冲突'),
        ('class', '班级冲突'),
        ('locked', '锁定课次冲突'),
    ]

    semester = models.ForeignKey(Semester, on_delete=models.CASCADE)
    conflict_type = models.CharField(max_length=20, choices=CONFLICT_TYPES)
    day_of_week = models.IntegerField()
    period = models.IntegerField()
    involved_entries = models.JSONField(default=list)
    message = models.TextField()
    resolved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.get_conflict_type_display()} @ 周{self.day_of_week}第{self.period}节"


class SwapRequest(models.Model):
    STATUS_CHOICES = [
        ('pending', '待审批'),
        ('approved', '已批准'),
        ('rejected', '已拒绝'),
    ]

    semester = models.ForeignKey(Semester, on_delete=models.CASCADE)
    requesting_teacher = models.ForeignKey(
        Teacher, on_delete=models.CASCADE, related_name='swap_requests_made'
    )
    target_teacher = models.ForeignKey(
        Teacher, on_delete=models.CASCADE, related_name='swap_requests_received'
    )
    entry1 = models.ForeignKey(
        ScheduleEntry, on_delete=models.CASCADE, related_name='swap_source'
    )
    entry2 = models.ForeignKey(
        ScheduleEntry, on_delete=models.CASCADE, related_name='swap_target'
    )
    reason = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"调课申请: {self.requesting_teacher} <-> {self.target_teacher}"


class Substitute(models.Model):
    semester = models.ForeignKey(Semester, on_delete=models.CASCADE)
    original_teacher = models.ForeignKey(
        Teacher, on_delete=models.CASCADE, related_name='absences'
    )
    substitute_teacher = models.ForeignKey(
        Teacher, on_delete=models.CASCADE, related_name='substitutions'
    )
    affected_entry = models.ForeignKey(
        ScheduleEntry, on_delete=models.CASCADE, related_name='substitute_record'
    )
    start_date = models.DateField()
    end_date = models.DateField()
    reason = models.TextField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.substitute_teacher} 代 {self.original_teacher}"
