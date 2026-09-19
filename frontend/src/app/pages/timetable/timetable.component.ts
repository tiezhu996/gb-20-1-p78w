import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { FullCalendarModule } from '@fullcalendar/angular';
import { ApiService } from '../../services/api.service';
import type {
  ScheduleEntry, Semester, Class, Teacher, Classroom,
  Conflict, UnscheduledCourse, UnscheduledReasonCode
} from '../../types';

interface GridCell {
  day: number;
  period: number;
}

@Component({
  selector: 'app-timetable',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatSelectModule,
    MatButtonModule,
    MatCheckboxModule,
    MatCardModule,
    MatTableModule,
    MatIconModule,
    MatChipsModule,
    FullCalendarModule
  ],
  template: `
    <div class="page-container">
      <h1 class="page-title">课表管理</h1>

      <div class="filter-bar">
        <mat-form-field class="filter-select">
          <mat-label>学期</mat-label>
          <mat-select [(value)]="selectedSemesterId" (selectionChange)="onSemesterChange()">
            <mat-option *ngFor="let s of semesters" [value]="s.id">
              {{ s.name }}
              <span *ngIf="s.is_active" style="color: green;"> (当前)</span>
            </mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field class="filter-select">
          <mat-label>查看方式</mat-label>
          <mat-select [(value)]="viewMode" (selectionChange)="onViewFilterChange()">
            <mat-option value="class">按班级</mat-option>
            <mat-option value="teacher">按教师</mat-option>
            <mat-option value="classroom">按教室</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field class="filter-select" *ngIf="viewMode === 'class'">
          <mat-label>班级</mat-label>
          <mat-select [(value)]="selectedClassId" (selectionChange)="onViewFilterChange()">
            <mat-option *ngFor="let c of classes" [value]="c.id">
              {{ c.grade }}年级 {{ c.name }}
            </mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field class="filter-select" *ngIf="viewMode === 'teacher'">
          <mat-label>教师</mat-label>
          <mat-select [(value)]="selectedTeacherId" (selectionChange)="onViewFilterChange()">
            <mat-option *ngFor="let t of teachers" [value]="t.id">
              {{ t.name }}
            </mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field class="filter-select" *ngIf="viewMode === 'classroom'">
          <mat-label>教室</mat-label>
          <mat-select [(value)]="selectedClassroomId" (selectionChange)="onViewFilterChange()">
            <mat-option *ngFor="let c of classrooms" [value]="c.id">
              {{ c.name }}
            </mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      <div class="action-bar">
        <button mat-raised-button color="primary" (click)="runAutoSchedule(true)" [disabled]="!selectedSemesterId || scheduling">
          <mat-icon>auto_awesome</mat-icon>
          {{ scheduling ? '排课中...' : '自动排课（保留锁定）' }}
        </button>
        <button mat-raised-button (click)="runAutoSchedule(false)" [disabled]="!selectedSemesterId || scheduling">
          <mat-icon>refresh</mat-icon>
          重新排课（忽略锁定）
        </button>
        <button mat-button (click)="reloadAll()">
          <mat-icon>refresh</mat-icon>
          刷新
        </button>
        <button mat-raised-button color="accent" (click)="exportPdf()" [disabled]="!canExport">
          <mat-icon>picture_as_pdf</mat-icon>
          导出 PDF
        </button>
        <button mat-raised-button (click)="exportImage()" [disabled]="!canExport">
          <mat-icon>image</mat-icon>
          导出图片
        </button>
      </div>

      <!-- 已排 / 未排 / 冲突数量总览 -->
      <div class="stats-bar" *ngIf="selectedSemesterId">
        <mat-card class="stat-mini scheduled">
          <mat-icon>event_available</mat-icon>
          <div>
            <div class="stat-mini-value">{{ statusStats.scheduledEntries }}</div>
            <div class="stat-mini-label">已排课次（含锁定 {{ statusStats.lockedEntries }}）</div>
          </div>
        </mat-card>
        <mat-card class="stat-mini unscheduled" [class.has-warning]="statusStats.unscheduledHours > 0">
          <mat-icon>event_busy</mat-icon>
          <div>
            <div class="stat-mini-value">{{ statusStats.unscheduledHours }}</div>
            <div class="stat-mini-label">未排课时 · {{ statusStats.unscheduledCourseCount }} 门课程</div>
          </div>
        </mat-card>
        <mat-card class="stat-mini conflict" [class.has-warning]="statusStats.conflictCount > 0">
          <mat-icon>warning</mat-icon>
          <div>
            <div class="stat-mini-value">{{ statusStats.conflictCount }}</div>
            <div class="stat-mini-label">已排冲突（可点击下方列表定位）</div>
          </div>
        </mat-card>
      </div>

      <div *ngIf="schedulingMessage" class="result-banner" [class.warn]="schedulingWarn">
        <mat-icon>{{ schedulingWarn ? 'warning_amber' : 'check_circle' }}</mat-icon>
        <span>{{ schedulingMessage }}</span>
      </div>

      <!-- 冲突项：点击定位到对应课程所在格子 -->
      <mat-card class="issue-panel" *ngIf="semesterConflicts.length > 0">
        <mat-card-content>
          <h3 class="issue-title">
            <mat-icon>warning</mat-icon>
            已排冲突（{{ semesterConflicts.length }}）— 点击条目定位
          </h3>
          <div class="issue-list">
            <button
              type="button"
              class="issue-chip conflict-chip"
              *ngFor="let c of semesterConflicts"
              (click)="locateConflict(c)"
              [class.issue-chip-active]="isCellActive(c.day_of_week, c.period)"
            >
              <span class="issue-chip-head">
                {{ conflictTypeLabel(c.conflict_type) }} · 周{{ c.day_of_week }}第{{ c.period }}节
              </span>
              <span class="issue-chip-body">{{ conflictResourceLabel(c) }}</span>
            </button>
          </div>
        </mat-card-content>
      </mat-card>

      <!-- 未排课程：资源不足留痕，点击定位到对应班级/教师课表 -->
      <mat-card class="issue-panel" *ngIf="unscheduledCourses.length > 0">
        <mat-card-content>
          <h3 class="issue-title unscheduled-title">
            <mat-icon>event_busy</mat-icon>
            未能排满的课程（{{ unscheduledCourses.length }}）— 点击条目定位课程
          </h3>
          <div class="issue-list">
            <button
              type="button"
              class="issue-chip unscheduled-chip"
              *ngFor="let u of unscheduledCourses"
              (click)="locateUnscheduled(u)"
              [class.issue-chip-active]="isUnscheduledActive(u)"
            >
              <span class="issue-chip-head">
                {{ u.class_name }} · {{ u.course_name }}（{{ u.teacher_name }}）
                缺 {{ u.unscheduled_hours }} 课时
              </span>
              <span class="issue-chip-body">
                {{ reasonLabel(u.reason_code) }}：{{ u.reason_detail }}
              </span>
            </button>
          </div>
        </mat-card-content>
      </mat-card>

      <div class="timetable-container" #timetableContainer>
        <div *ngIf="schedules.length > 0">
          <h3 style="padding: 16px 16px 0; margin: 0;">{{ currentViewTitle }}</h3>

          <div style="padding: 16px; overflow-x: auto;">
            <table class="mat-elevation-z2" style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background: #1976d2; color: white;">
                  <th style="padding: 12px; text-align: center; min-width: 100px;">节次</th>
                  <th *ngFor="let day of weekDays" style="padding: 12px; text-align: center; min-width: 150px;">
                    {{ day }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let period of periods; let i = index" [style.background]="i % 2 === 0 ? '#f9f9f9' : 'white'">
                  <td style="padding: 12px; text-align: center; font-weight: bold; border: 1px solid #ddd;">
                    {{ period.name }}
                  </td>
                  <td
                    *ngFor="let day of [1,2,3,4,5]"
                    class="grid-cell"
                    [attr.id]="cellId(day, i + 1)"
                    [class.cell-highlight]="isCellActive(day, i + 1)"
                    style="padding: 8px; border: 1px solid #ddd; vertical-align: top; min-height: 80px;"
                  >
                    <ng-container *ngFor="let entry of getEntryAt(day, i + 1)">
                      <mat-card
                        class="schedule-card"
                        [class.conflict-entry]="entry.is_conflict"
                        [class.locked-entry]="entry.is_locked"
                        [attr.data-entry-id]="entry.id"
                        style="margin-bottom: 4px;"
                      >
                        <div class="schedule-course">{{ entry.course_name }}</div>
                        <div class="schedule-detail">{{ entry.teacher_name }}</div>
                        <div class="schedule-detail">{{ entry.classroom_name }}</div>
                        <div class="schedule-detail">{{ entry.class_name }}</div>
                        <div style="margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap;">
                          <mat-chip *ngIf="entry.is_locked" color="accent" selected>锁定</mat-chip>
                          <mat-chip *ngIf="entry.is_conflict" color="warn" selected>冲突</mat-chip>
                          <button
                            mat-icon-button
                            size="small"
                            (click)="toggleLock(entry)"
                            [title]="entry.is_locked ? '解锁' : '锁定'"
                          >
                            <mat-icon>{{ entry.is_locked ? 'lock' : 'lock_open' }}</mat-icon>
                          </button>
                        </div>
                      </mat-card>
                    </ng-container>
                    <div *ngIf="getEntryAt(day, i + 1).length === 0" class="empty-slot-hint">—</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div *ngIf="schedules.length === 0 && selectedSemesterId" style="padding: 40px; text-align: center;">
          <p>当前视角下没有已排课次。点击“自动排课（保留锁定）”开始排课，未排课程会在上方列出具体原因。</p>
        </div>

        <div *ngIf="!selectedSemesterId" style="padding: 40px; text-align: center;">
          <p>请先选择一个学期。</p>
        </div>
      </div>
    </div>
  `
})
export class TimetableComponent implements OnInit {
  @ViewChild('timetableContainer') timetableContainer!: ElementRef;

  semesters: Semester[] = [];
  classes: Class[] = [];
  teachers: Teacher[] = [];
  classrooms: Classroom[] = [];
  schedules: ScheduleEntry[] = [];
  semesterConflicts: Conflict[] = [];
  unscheduledCourses: UnscheduledCourse[] = [];
  selectedSemesterId: number | null = null;
  selectedClassId: number | null = null;
  selectedTeacherId: number | null = null;
  selectedClassroomId: number | null = null;
  viewMode: 'class' | 'teacher' | 'classroom' = 'class';
  schedulingMessage = '';
  schedulingWarn = false;
  scheduling = false;
  currentSemester: Semester | null = null;

  // 当前定位的冲突格子 / 未排课程
  activeCell: GridCell | null = null;
  activeUnscheduledKey = '';
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;

  statusStats = {
    scheduledEntries: 0,
    lockedEntries: 0,
    unscheduledHours: 0,
    unscheduledCourseCount: 0,
    conflictCount: 0
  };

  weekDays = ['星期一', '星期二', '星期三', '星期四', '星期五'];
  periods = [
    { name: '第1节', order: 1 },
    { name: '第2节', order: 2 },
    { name: '第3节', order: 3 },
    { name: '第4节', order: 4 },
    { name: '第5节', order: 5 },
    { name: '第6节', order: 6 },
    { name: '第7节', order: 7 },
  ];

  private reasonLabels: Record<UnscheduledReasonCode, string> = {
    no_classroom: '无可用教室',
    teacher_unavailable: '教师可用时间不足',
    class_busy: '班级时间被占满',
    teacher_busy: '教师时间被占满',
    classroom_busy: '教室时间被占满',
    capacity_shortage: '教室容量不足',
    no_slots: '综合资源不足'
  };

  constructor(
    private api: ApiService,
    private route: ActivatedRoute
  ) {}

  get canExport(): boolean {
    if (!this.selectedSemesterId) return false;
    if (this.viewMode === 'class') return !!this.selectedClassId;
    if (this.viewMode === 'teacher') return !!this.selectedTeacherId;
    if (this.viewMode === 'classroom') return !!this.selectedClassroomId;
    return false;
  }

  get currentViewTitle(): string {
    if (this.viewMode === 'class') {
      const cls = this.classes.find(c => c.id === this.selectedClassId);
      return cls ? `${cls.grade}年级 ${cls.name} 课表` : '';
    }
    if (this.viewMode === 'teacher') {
      const t = this.teachers.find(t => t.id === this.selectedTeacherId);
      return t ? `${t.name} 教师课表` : '';
    }
    if (this.viewMode === 'classroom') {
      const c = this.classrooms.find(c => c.id === this.selectedClassroomId);
      return c ? `${c.name} 教室课表` : '';
    }
    return '';
  }

  ngOnInit(): void {
    // 支持从冲突管理页带参跳转过来直接定位
    this.route.queryParamMap.subscribe(params => {
      const semesterId = params.get('semester_id');
      if (semesterId) this.selectedSemesterId = Number(semesterId);
      const mode = params.get('view');
      if (mode === 'class' || mode === 'teacher' || mode === 'classroom') {
        this.viewMode = mode;
      }
      const classId = params.get('class_id');
      if (classId) this.selectedClassId = Number(classId);
      const teacherId = params.get('teacher_id');
      if (teacherId) this.selectedTeacherId = Number(teacherId);
      const classroomId = params.get('classroom_id');
      if (classroomId) this.selectedClassroomId = Number(classroomId);
      const day = Number(params.get('day'));
      const period = Number(params.get('period'));
      if (day && period) {
        this.activeCell = { day, period };
      }
    });

    this.loadSemesters();
    this.loadClasses();
    this.loadTeachers();
    this.loadClassrooms();
  }

  loadSemesters(): void {
    this.api.getSemesters().subscribe(data => {
      this.semesters = data;
      if (!this.selectedSemesterId) {
        const active = data.find(s => s.is_active);
        if (active) this.selectedSemesterId = active.id;
      }
      if (this.selectedSemesterId) {
        this.currentSemester = data.find(s => s.id === this.selectedSemesterId) || null;
        this.updatePeriodsFromSemester();
        this.reloadAll();
      }
    });
  }

  loadClasses(): void {
    this.api.getClasses().subscribe(data => {
      this.classes = data;
      if (data.length > 0 && !this.selectedClassId) {
        this.selectedClassId = data[0].id;
        if (this.selectedSemesterId) this.loadSchedules();
      }
    });
  }

  loadTeachers(): void {
    this.api.getTeachers().subscribe(data => {
      this.teachers = data;
      if (data.length > 0 && !this.selectedTeacherId) {
        this.selectedTeacherId = data[0].id;
      }
    });
  }

  loadClassrooms(): void {
    this.api.getClassrooms().subscribe(data => {
      this.classrooms = data;
      if (data.length > 0 && !this.selectedClassroomId) {
        this.selectedClassroomId = data[0].id;
      }
    });
  }

  updatePeriodsFromSemester(): void {
    if (this.currentSemester?.daily_periods?.length) {
      this.periods = this.currentSemester.daily_periods
        .slice()
        .sort((a, b) => a.order - b.order);
    }
  }

  onSemesterChange(): void {
    if (this.selectedSemesterId) {
      this.currentSemester = this.semesters.find(s => s.id === this.selectedSemesterId) || null;
      this.updatePeriodsFromSemester();
      this.reloadAll();
    }
  }

  onViewFilterChange(): void {
    this.clearHighlight();
    this.loadSchedules();
  }

  /** 重新加载当前视角课表 + 学期维度的未排/冲突统计 */
  reloadAll(): void {
    this.loadSchedules();
    this.loadSchedulingStatus();
  }

  loadSchedules(): void {
    if (!this.selectedSemesterId) return;

    let obs;
    if (this.viewMode === 'class' && this.selectedClassId) {
      obs = this.api.getSchedulesByClass(this.selectedSemesterId, this.selectedClassId);
    } else if (this.viewMode === 'teacher' && this.selectedTeacherId) {
      obs = this.api.getSchedulesByTeacher(this.selectedSemesterId, this.selectedTeacherId);
    } else if (this.viewMode === 'classroom' && this.selectedClassroomId) {
      obs = this.api.getSchedulesByClassroom(this.selectedSemesterId, this.selectedClassroomId);
    } else {
      obs = this.api.getSchedulesBySemester(this.selectedSemesterId);
    }

    obs.subscribe(data => {
      this.schedules = data;
      // 从冲突管理页带 day/period 参数跳转时，数据到达后再滚动定位
      if (this.activeCell) {
        const { day, period } = this.activeCell;
        setTimeout(() => this.scrollToCell(day, period), 100);
      }
    });
  }

  loadSchedulingStatus(): void {
    if (!this.selectedSemesterId) return;
    this.api.getSchedulingStatus(this.selectedSemesterId).subscribe(status => {
      this.statusStats = {
        scheduledEntries: status.scheduled_entries,
        lockedEntries: status.locked_entries,
        unscheduledHours: status.unscheduled_hours,
        unscheduledCourseCount: status.unscheduled_courses.length,
        conflictCount: status.conflict_count
      };
      this.unscheduledCourses = status.unscheduled_courses;
      this.semesterConflicts = status.conflicts;
    });
  }

  getEntryAt(day: number, period: number): ScheduleEntry[] {
    return this.schedules.filter(e => e.day_of_week === day && e.period === period);
  }

  cellId(day: number, period: number): string {
    return `cell-${day}-${period}`;
  }

  isCellActive(day: number, period: number): boolean {
    return !!this.activeCell && this.activeCell.day === day && this.activeCell.period === period;
  }

  isUnscheduledActive(u: UnscheduledCourse): boolean {
    return this.activeUnscheduledKey === this.unscheduledKey(u);
  }

  unscheduledKey(u: UnscheduledCourse): string {
    return `${u.class_id}-${u.course}-${u.teacher}`;
  }

  reasonLabel(code: UnscheduledReasonCode): string {
    return this.reasonLabels[code] || code;
  }

  conflictTypeLabel(type: string): string {
    const map: Record<string, string> = {
      teacher: '教师冲突',
      classroom: '教室冲突',
      class: '班级冲突'
    };
    return map[type] || type;
  }

  conflictResourceLabel(c: Conflict): string {
    if (c.conflict_type === 'teacher') {
      return c.related_teacher_name ? `教师：${c.related_teacher_name}` : c.message;
    }
    if (c.conflict_type === 'classroom') {
      return c.related_classroom_name ? `教室：${c.related_classroom_name}` : c.message;
    }
    return c.related_class_name ? `班级：${c.related_class_name}` : c.message;
  }

  /** 点击冲突项：切换到对应视角并高亮时间格子 */
  locateConflict(c: Conflict): void {
    this.clearHighlight();
    if (c.conflict_type === 'teacher' && c.related_teacher) {
      this.viewMode = 'teacher';
      this.selectedTeacherId = c.related_teacher;
    } else if (c.conflict_type === 'classroom' && c.related_classroom) {
      this.viewMode = 'classroom';
      this.selectedClassroomId = c.related_classroom;
    } else if (c.conflict_type === 'class' && c.related_class) {
      this.viewMode = 'class';
      this.selectedClassId = c.related_class;
    }
    this.activeCell = { day: c.day_of_week, period: c.period };
    this.loadSchedules();
    setTimeout(() => this.scrollToCell(c.day_of_week, c.period), 350);
  }

  /** 点击未排课程：切换到班级视角并定位该课程所属班级课表 */
  locateUnscheduled(u: UnscheduledCourse): void {
    this.clearHighlight();
    this.viewMode = 'class';
    this.selectedClassId = u.class_id;
    this.activeUnscheduledKey = this.unscheduledKey(u);
    this.loadSchedules();
    setTimeout(() => {
      // 未排课程没有课表格子，滚动到课表区域让用户查看该班级已排部分
      this.timetableContainer?.nativeElement.scrollIntoView({
        behavior: 'smooth', block: 'start'
      });
    }, 350);
    this.schedulingMessage =
      `已定位到 ${u.class_name} 的《${u.course_name}》：${this.reasonLabel(u.reason_code)}，` +
      `缺 ${u.unscheduled_hours} 课时（已排 ${u.scheduled_hours}，锁定保留 ${u.locked_hours}）`;
    this.schedulingWarn = true;
  }

  private scrollToCell(day: number, period: number): void {
    const el = document.getElementById(this.cellId(day, period));
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => this.clearHighlight(), 6000);
  }

  private clearHighlight(): void {
    this.activeCell = null;
    this.activeUnscheduledKey = '';
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
      this.highlightTimer = null;
    }
  }

  runAutoSchedule(respectLocked = true): void {
    if (!this.selectedSemesterId || this.scheduling) return;
    this.scheduling = true;
    this.schedulingMessage = '正在自动排课，请稍候...';
    this.schedulingWarn = false;

    this.api.autoSchedule(this.selectedSemesterId, respectLocked).subscribe({
      next: result => {
        const summary = result.summary;
        const unscheduled = result.unscheduled_courses || [];
        this.schedulingWarn = summary.unscheduled_hours > 0 || summary.conflict_count > 0;
        this.schedulingMessage =
          `排课完成：已排 ${summary.scheduled_entries} 个课次（其中锁定保留 ${summary.locked_hours} 课时，` +
          `本次新排 ${summary.newly_scheduled_hours} 课时），未排 ${summary.unscheduled_hours} 课时` +
          `（${summary.unscheduled_course_count} 门课程），冲突 ${summary.conflict_count} 个。` +
          (summary.unscheduled_hours > 0
            ? ' 资源不足的课程已在下方逐条列出原因，不会被静默丢弃。'
            : ' 所有课程均已排满。');
        this.reloadAll();
      },
      error: () => {
        this.schedulingMessage = '自动排课失败，请检查学期基础数据后重试。';
        this.schedulingWarn = true;
      },
      complete: () => {
        this.scheduling = false;
      }
    });
  }

  toggleLock(entry: ScheduleEntry): void {
    this.api.updateScheduleEntry(entry.id, { is_locked: !entry.is_locked }).subscribe(() => {
      entry.is_locked = !entry.is_locked;
      this.loadSchedulingStatus();
    });
  }

  exportPdf(): void {
    if (!this.selectedSemesterId) return;
    let type: 'class' | 'teacher' | 'classroom' = 'class';
    let id = 0;

    if (this.viewMode === 'class' && this.selectedClassId) {
      type = 'class';
      id = this.selectedClassId;
    } else if (this.viewMode === 'teacher' && this.selectedTeacherId) {
      type = 'teacher';
      id = this.selectedTeacherId;
    } else if (this.viewMode === 'classroom' && this.selectedClassroomId) {
      type = 'classroom';
      id = this.selectedClassroomId;
    } else {
      return;
    }

    this.api.exportPdf(this.selectedSemesterId, type, id).subscribe(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'timetable.pdf';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  async exportImage(): Promise<void> {
    try {
      const html2canvas = (await import('html2canvas')).default;
      const element = this.timetableContainer.nativeElement;
      const canvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: 2
      });
      const link = document.createElement('a');
      link.download = 'timetable.png';
      link.href = canvas.toDataURL();
      link.click();
    } catch (e) {
      alert('图片导出功能需要 html2canvas 库');
      console.error(e);
    }
  }
}
