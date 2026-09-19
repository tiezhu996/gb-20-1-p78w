from django.contrib import admin
from .models import (
    ClassCourse, ScheduleEntry, Conflict, UnscheduledCourse,
    SwapRequest, Substitute
)


@admin.register(UnscheduledCourse)
class UnscheduledCourseAdmin(admin.ModelAdmin):
    list_display = (
        'semester', 'class_id', 'course', 'teacher',
        'weekly_hours', 'scheduled_hours', 'unscheduled_hours', 'reason'
    )
    list_filter = ('semester', 'reason')
    search_fields = ('class_id__name', 'course__name', 'teacher__name', 'detail')


admin.site.register(ClassCourse)
admin.site.register(ScheduleEntry)
admin.site.register(Conflict)
admin.site.register(SwapRequest)
admin.site.register(Substitute)
