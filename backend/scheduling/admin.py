from django.contrib import admin
from .models import (
    ClassCourse, ScheduleEntry, Conflict, SwapRequest, Substitute,
    UnscheduledCourse
)


@admin.register(UnscheduledCourse)
class UnscheduledCourseAdmin(admin.ModelAdmin):
    list_display = (
        'semester', 'class_id', 'course', 'teacher',
        'unscheduled_hours', 'reason_code', 'created_at'
    )
    list_filter = ('semester', 'reason_code')
    search_fields = ('course__name', 'teacher__name', 'class_id__name')


admin.site.register(ClassCourse)
admin.site.register(ScheduleEntry)
admin.site.register(Conflict)
admin.site.register(SwapRequest)
admin.site.register(Substitute)
