from django.http import HttpResponse
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from django.db import transaction
from typing import Dict
from core.models import Semester, Classroom, Teacher, Class
from .models import (
    ClassCourse, ScheduleEntry, Conflict, SwapRequest, Substitute,
    UnscheduledCourse
)
from .serializers import (
    ClassCourseSerializer, ScheduleEntrySerializer,
    ScheduleEntryDetailSerializer, ConflictSerializer,
    SwapRequestSerializer, SubstituteSerializer,
    UnscheduledCourseSerializer,
    AutoScheduleRequestSerializer, ConflictCheckSerializer,
    SwapScheduleRequestSerializer, SubstituteRequestSerializer
)
from .csp_solver import CSPScheduler, ConflictDetector, SchedulingTask, TimeSlot
from .pdf_export import (
    generate_class_timetable_pdf,
    generate_teacher_timetable_pdf,
    generate_classroom_timetable_pdf
)


class ClassCourseViewSet(viewsets.ModelViewSet):
    queryset = ClassCourse.objects.all()
    serializer_class = ClassCourseSerializer
    permission_classes = [AllowAny]


class ScheduleEntryViewSet(viewsets.ModelViewSet):
    queryset = ScheduleEntry.objects.all().select_related(
        'course', 'teacher', 'classroom', 'class_id', 'semester'
    )
    serializer_class = ScheduleEntryDetailSerializer
    permission_classes = [AllowAny]

    def get_serializer_class(self):
        if self.action in ['list', 'retrieve']:
            return ScheduleEntryDetailSerializer
        return ScheduleEntrySerializer

    @action(detail=False, methods=['get'])
    def by_semester(self, request):
        semester_id = request.query_params.get('semester_id')
        if not semester_id:
            return Response(
                {'error': 'semester_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        entries = self.queryset.filter(semester_id=semester_id)
        serializer = ScheduleEntryDetailSerializer(entries, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def by_class(self, request):
        semester_id = request.query_params.get('semester_id')
        class_id = request.query_params.get('class_id')
        entries = self.queryset.filter(semester_id=semester_id, class_id=class_id)
        serializer = ScheduleEntryDetailSerializer(entries, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def by_teacher(self, request):
        semester_id = request.query_params.get('semester_id')
        teacher_id = request.query_params.get('teacher_id')
        entries = self.queryset.filter(semester_id=semester_id, teacher_id=teacher_id)
        serializer = ScheduleEntryDetailSerializer(entries, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def by_classroom(self, request):
        semester_id = request.query_params.get('semester_id')
        classroom_id = request.query_params.get('classroom_id')
        entries = self.queryset.filter(semester_id=semester_id, classroom_id=classroom_id)
        serializer = ScheduleEntryDetailSerializer(entries, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def auto_schedule(self, request):
        req_serializer = AutoScheduleRequestSerializer(data=request.data)
        if not req_serializer.is_valid():
            return Response(req_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        semester_id = req_serializer.validated_data['semester_id']
        respect_locked = req_serializer.validated_data['respect_locked']

        try:
            semester = Semester.objects.get(id=semester_id)
        except Semester.DoesNotExist:
            return Response(
                {'error': 'Semester not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        class_courses = ClassCourse.objects.filter(
            semester=semester
        ).select_related('class_id', 'course', 'teacher')

        if not class_courses.exists():
            return Response(
                {'error': 'No class courses configured for this semester'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # 已锁定课次必须保留：按 (班级, 课程, 教师) 统计锁定课时，
        # 自动排课只补排差额，绝不再为同一任务重复排满全部周课时
        locked_qs = ScheduleEntry.objects.filter(semester=semester)
        if respect_locked:
            locked_qs = locked_qs.filter(is_locked=True)
        else:
            locked_qs = locked_qs.none()

        locked_hours_map: Dict[tuple, int] = {}
        locked_entries = []
        if respect_locked:
            locked_rows = locked_qs.values(
                'id', 'class_id', 'teacher_id', 'classroom_id',
                'course_id', 'day_of_week', 'period', 'is_locked'
            )
            for row in locked_rows:
                locked_entries.append(dict(row))
                key = (row['class_id'], row['course_id'], row['teacher_id'])
                locked_hours_map[key] = locked_hours_map.get(key, 0) + 1

        tasks = []
        for cc in class_courses:
            key = (cc.class_id_id, cc.course_id, cc.teacher_id)
            tasks.append(SchedulingTask(
                class_id=cc.class_id.id,
                course_id=cc.course.id,
                teacher_id=cc.teacher.id,
                weekly_hours=cc.course.weekly_hours,
                preferred_room_type=cc.course.preferred_room_type,
                priority=cc.course.priority,
                available_time_slots=[],
                classroom_capacity=cc.class_id.student_count or 40,
                class_course_id=cc.id,
                locked_hours=locked_hours_map.get(key, 0)
            ))

        classrooms_data = {
            c.id: {
                'room_type': c.room_type,
                'capacity': c.capacity,
                'name': c.name
            } for c in Classroom.objects.filter(is_active=True)
        }

        teachers_data = {
            t.id: {
                'name': t.name,
                'available_time_slots': t.available_time_slots if t.available_time_slots else []
            } for t in Teacher.objects.filter(is_active=True)
        }

        scheduler = CSPScheduler(semester)
        assignments, unscheduled_results = scheduler.schedule(
            tasks, classrooms_data, teachers_data, locked_entries
        )
        # 锁定课次在 assignments 中带 is_locked=True，其余为本次新排
        newly_scheduled_hours = sum(
            1 for a in assignments if not a.get('is_locked')
        )

        with transaction.atomic():
            if respect_locked:
                ScheduleEntry.objects.filter(
                    semester=semester, is_locked=False
                ).delete()
            else:
                ScheduleEntry.objects.filter(semester=semester).delete()

            bulk_entries = []
            for a in assignments:
                if a.get('is_locked'):
                    continue
                bulk_entries.append(ScheduleEntry(
                    semester_id=a['semester_id'],
                    class_id_id=a['class_id'],
                    course_id=a['course_id'],
                    teacher_id=a['teacher_id'],
                    classroom_id=a['classroom_id'],
                    day_of_week=a['day_of_week'],
                    period=a['period'],
                    is_locked=False
                ))
            ScheduleEntry.objects.bulk_create(bulk_entries)

            all_entries = ScheduleEntry.objects.filter(
                semester=semester
            ).values(
                'id', 'teacher_id', 'classroom_id', 'class_id',
                'day_of_week', 'period', 'is_locked'
            )

            detector = ConflictDetector()
            conflicts = detector.detect_conflicts(list(all_entries))

            Conflict.objects.filter(semester=semester).delete()
            bulk_conflicts = []
            for c in conflicts:
                bulk_conflicts.append(Conflict(
                    semester=semester,
                    conflict_type=c['conflict_type'],
                    day_of_week=c['day_of_week'],
                    period=c['period'],
                    involved_entries=c['involved_entries'],
                    message=c['message'],
                    related_teacher_id=c.get('related_teacher_id'),
                    related_classroom_id=c.get('related_classroom_id'),
                    related_class_id=c.get('related_class_id'),
                ))
            Conflict.objects.bulk_create(bulk_conflicts)

            # 重置旧标记后，仅把真正参与冲突的课次标红
            ScheduleEntry.objects.filter(semester=semester).update(
                is_conflict=False, conflict_type=''
            )
            conflict_entry_ids = {
                eid for c in conflicts for eid in c['involved_entries']
            }
            entry_conflict_type: Dict[int, str] = {}
            for c in conflicts:
                for eid in c['involved_entries']:
                    entry_conflict_type.setdefault(eid, c['conflict_type'])
            for eid in conflict_entry_ids:
                ScheduleEntry.objects.filter(id=eid).update(
                    is_conflict=True,
                    conflict_type=entry_conflict_type.get(eid, '')
                )

            # 未排课程落库：每次自动排课刷新该学期的未排记录，
            # 已全部排满的课程对应旧记录随之清除，保证资源不足绝不静默丢课
            UnscheduledCourse.objects.filter(semester=semester).delete()
            bulk_unscheduled = []
            for u in unscheduled_results:
                bulk_unscheduled.append(UnscheduledCourse(
                    semester=semester,
                    class_id_id=u['class_id'],
                    course_id=u['course_id'],
                    teacher_id=u['teacher_id'],
                    requested_hours=u['requested_hours'],
                    locked_hours=u['locked_hours'],
                    scheduled_hours=u['scheduled_hours'],
                    unscheduled_hours=u['unscheduled_hours'],
                    reason_code=u['reason_code'],
                    reason_detail=u['reason_detail'],
                    blocking_slots=u.get('blocking_slots', [])
                ))
            UnscheduledCourse.objects.bulk_create(bulk_unscheduled)

        final_entries = ScheduleEntry.objects.filter(semester=semester)
        serializer = ScheduleEntryDetailSerializer(final_entries, many=True)
        unscheduled_serializer = UnscheduledCourseSerializer(
            UnscheduledCourse.objects.filter(semester=semester)
            .select_related('class_id', 'course', 'teacher'),
            many=True
        )

        locked_total = sum(t.locked_hours for t in tasks)
        required_total = sum(t.weekly_hours for t in tasks)
        unscheduled_hours_total = sum(u['unscheduled_hours'] for u in unscheduled_results)

        # 兼容旧字段 scheduling_messages，同时提供结构化的 unscheduled_courses
        legacy_messages = [
            {
                'type': 'unscheduled',
                'class_course_id': u['class_course_id'],
                'class_id': u['class_id'],
                'course_id': u['course_id'],
                'teacher_id': u['teacher_id'],
                'reason_code': u['reason_code'],
                'message': u['reason_detail']
            }
            for u in unscheduled_results
        ]

        return Response({
            'schedule': serializer.data,
            'conflicts': conflicts,
            'unscheduled_courses': unscheduled_serializer.data,
            'scheduling_messages': legacy_messages,
            'total_entries': len(serializer.data),
            'summary': {
                'required_hours': required_total,
                'locked_hours': locked_total,
                'newly_scheduled_hours': newly_scheduled_hours,
                'unscheduled_hours': unscheduled_hours_total,
                'scheduled_entries': len(serializer.data),
                'conflict_count': len(conflicts),
                'unscheduled_course_count': len(unscheduled_results)
            }
        })

    @action(detail=False, methods=['post'])
    def check_conflicts(self, request):
        req_serializer = ConflictCheckSerializer(data=request.data)
        if not req_serializer.is_valid():
            return Response(req_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        semester_id = req_serializer.validated_data['semester_id']
        entries = ScheduleEntry.objects.filter(
            semester_id=semester_id
        ).values(
            'id', 'teacher_id', 'classroom_id', 'class_id',
            'day_of_week', 'period', 'is_locked'
        )

        detector = ConflictDetector()
        conflicts = detector.detect_conflicts(list(entries))

        return Response({'conflicts': conflicts})

    @action(detail=False, methods=['get'])
    def scheduling_status(self, request):
        """课表页汇总数据：已排/未排数量、未排课程明细、当前冲突，供页面展示与定位。"""
        semester_id = request.query_params.get('semester_id')
        if not semester_id:
            return Response(
                {'error': 'semester_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        entries = ScheduleEntry.objects.filter(semester_id=semester_id)
        unscheduled = UnscheduledCourse.objects.filter(
            semester_id=semester_id
        ).select_related('class_id', 'course', 'teacher')
        conflicts_qs = Conflict.objects.filter(semester_id=semester_id)

        scheduled_entries = entries.count()
        locked_entries = entries.filter(is_locked=True).count()
        unscheduled_records = UnscheduledCourseSerializer(unscheduled, many=True).data
        conflict_data = ConflictSerializer(conflicts_qs, many=True).data

        # 要求课时来自该学期的课程分配，未排课时来自未排留痕记录
        required_hours = sum(
            cc.course.weekly_hours
            for cc in ClassCourse.objects.filter(semester_id=semester_id)
            .select_related('course')
        )
        unscheduled_hours = sum(u.unscheduled_hours for u in unscheduled)
        scheduled_hours = entries.count()

        return Response({
            'semester_id': int(semester_id),
            'scheduled_entries': scheduled_entries,
            'locked_entries': locked_entries,
            'scheduled_hours': scheduled_hours,
            'unscheduled_hours': unscheduled_hours,
            'required_hours': required_hours,
            'conflict_count': conflicts_qs.count(),
            'unscheduled_courses': unscheduled_records,
            'conflicts': conflict_data
        })

    @action(detail=False, methods=['post'])
    def swap(self, request):
        req_serializer = SwapScheduleRequestSerializer(data=request.data)
        if not req_serializer.is_valid():
            return Response(req_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        entry1_id = req_serializer.validated_data['entry1_id']
        entry2_id = req_serializer.validated_data['entry2_id']
        reason = req_serializer.validated_data.get('reason', '')

        try:
            entry1 = ScheduleEntry.objects.get(id=entry1_id)
            entry2 = ScheduleEntry.objects.get(id=entry2_id)
        except ScheduleEntry.DoesNotExist:
            return Response(
                {'error': 'One or both entries not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        with transaction.atomic():
            day1, period1 = entry1.day_of_week, entry1.period
            day2, period2 = entry2.day_of_week, entry2.period

            entry1.day_of_week, entry1.period = day2, period2
            entry2.day_of_week, entry2.period = day1, period1

            entry1.save()
            entry2.save()

            if reason:
                SwapRequest.objects.create(
                    semester=entry1.semester,
                    requesting_teacher=entry1.teacher,
                    target_teacher=entry2.teacher,
                    entry1=entry1,
                    entry2=entry2,
                    reason=reason,
                    status='approved'
                )

        return Response({'status': 'success', 'message': 'Swap completed'})

    @action(detail=False, methods=['post'])
    def substitute(self, request):
        req_serializer = SubstituteRequestSerializer(data=request.data)
        if not req_serializer.is_valid():
            return Response(req_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        entry_id = req_serializer.validated_data['entry_id']
        substitute_teacher_id = req_serializer.validated_data['substitute_teacher_id']
        start_date = req_serializer.validated_data['start_date']
        end_date = req_serializer.validated_data['end_date']
        reason = req_serializer.validated_data['reason']

        try:
            entry = ScheduleEntry.objects.get(id=entry_id)
            substitute_teacher = Teacher.objects.get(id=substitute_teacher_id)
        except (ScheduleEntry.DoesNotExist, Teacher.DoesNotExist):
            return Response(
                {'error': 'Entry or teacher not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        original_teacher = entry.teacher

        with transaction.atomic():
            Substitute.objects.create(
                semester=entry.semester,
                original_teacher=original_teacher,
                substitute_teacher=substitute_teacher,
                affected_entry=entry,
                start_date=start_date,
                end_date=end_date,
                reason=reason
            )

            entry.original_teacher = original_teacher
            entry.teacher = substitute_teacher
            entry.save()

        serializer = ScheduleEntryDetailSerializer(entry)
        return Response({'status': 'success', 'entry': serializer.data})

    @action(detail=False, methods=['get'])
    def export_pdf(self, request):
        semester_id = request.query_params.get('semester_id')
        entity_type = request.query_params.get('type')
        entity_id = request.query_params.get('id')

        try:
            semester = Semester.objects.get(id=semester_id)
        except Semester.DoesNotExist:
            return Response(
                {'error': 'Semester not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        pdf_buffer = None
        filename = 'timetable.pdf'

        try:
            if entity_type == 'class':
                class_obj = Class.objects.get(id=entity_id)
                pdf_buffer = generate_class_timetable_pdf(class_obj, semester)
                filename = f'{class_obj.name}_课表.pdf'
            elif entity_type == 'teacher':
                teacher = Teacher.objects.get(id=entity_id)
                pdf_buffer = generate_teacher_timetable_pdf(teacher, semester)
                filename = f'{teacher.name}_课表.pdf'
            elif entity_type == 'classroom':
                classroom = Classroom.objects.get(id=entity_id)
                pdf_buffer = generate_classroom_timetable_pdf(classroom, semester)
                filename = f'{classroom.name}_课表.pdf'
            else:
                return Response(
                    {'error': 'Invalid type. Must be class, teacher, or classroom'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        except (Class.DoesNotExist, Teacher.DoesNotExist, Classroom.DoesNotExist):
            return Response(
                {'error': 'Entity not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        response = HttpResponse(pdf_buffer, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response


class ConflictViewSet(viewsets.ModelViewSet):
    queryset = Conflict.objects.all().select_related(
        'semester', 'related_teacher', 'related_classroom', 'related_class'
    )
    serializer_class = ConflictSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        queryset = self.queryset
        semester_id = self.request.query_params.get('semester_id')
        if semester_id:
            queryset = queryset.filter(semester_id=semester_id)
        unresolved = self.request.query_params.get('unresolved')
        if unresolved in ('1', 'true', 'True'):
            queryset = queryset.filter(resolved=False)
        return queryset


class UnscheduledCourseViewSet(viewsets.ReadOnlyModelViewSet):
    """未排课程留痕：自动排课未能排满的课次及具体原因。"""
    queryset = UnscheduledCourse.objects.all().select_related(
        'semester', 'class_id', 'course', 'teacher'
    )
    serializer_class = UnscheduledCourseSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        queryset = self.queryset
        semester_id = self.request.query_params.get('semester_id')
        if semester_id:
            queryset = queryset.filter(semester_id=semester_id)
        class_id = self.request.query_params.get('class_id')
        if class_id:
            queryset = queryset.filter(class_id=class_id)
        teacher_id = self.request.query_params.get('teacher_id')
        if teacher_id:
            queryset = queryset.filter(teacher_id=teacher_id)
        return queryset


class SwapRequestViewSet(viewsets.ModelViewSet):
    queryset = SwapRequest.objects.all().select_related(
        'semester', 'requesting_teacher', 'target_teacher'
    )
    serializer_class = SwapRequestSerializer
    permission_classes = [AllowAny]


class SubstituteViewSet(viewsets.ModelViewSet):
    queryset = Substitute.objects.all().select_related(
        'semester', 'original_teacher', 'substitute_teacher'
    )
    serializer_class = SubstituteSerializer
    permission_classes = [AllowAny]
