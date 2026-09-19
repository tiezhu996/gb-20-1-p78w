import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiService } from '../../services/api.service';
import type {
  ScheduleEntry, Semester, Class, Teacher, Classroom,
  Conflict, UnscheduledCourse, UnscheduledReason,
  AutoScheduleResult, AutoScheduleStats
} from '../../types';

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
    MatProgressBarModule
  ],
  styles: [`
    .stats-bar {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .stat-item {
      min-width: 130px;
      padding: 12px 16px;
      border-radius: 6px;
      background: #f5f7fa;
      border-left: 4px solid #1976d2;
    }
    .stat-item.locked { border-left-color: #fbc02d; }
    .stat-item.unscheduled { border-left-color: #f44336; background: #fdecea; }
    .stat-item.conflict { border-left-color: #ff9800; background: #fff5e6; }
    .stat-item.clickable { cursor: pointer; }
    .stat-item.clickable:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    .stat-item .num { font-size: 26px; font-weight: 700; line-height: 1.2; }
    .stat-item .lbl { font-size: 12px; color: #666; }
    .issue-panel {
      margin-top: 16px;
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .issue-panel > mat-card { flex: 1 1 420px; }
    .issue-row {
      cursor: pointer;
      padding: 8px 10px;
      border-bottom: 1px solid #eee;
    }
    .issue-row:hover { background: #e3f2fd; }
    .issue-title { font-weight: 500; }
    .issue-sub { font-size: 12px; color: #666; margin-top: 2px; }
    td.locate-cell { outline: 2px solid #f44336; outline-offset: -2px; }
    .locate-flash { animation: flash 1.6s ease-in-out; }
    @keyframes flash {
      0%, 60% { box-shadow: inset 0 0 0 9999px rgba(244,67,54,0.28); }
      100% { box-shadow: none; }
    }
  `],
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
          <mat-select [(value)]="viewMode" (selectionChange)="loadSchedules()">
            <mat-option value="class">按班级</mat-option>
            <mat-option value="teacher">按教师</mat-option>
            <mat-option value="classroom">按教室</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field class="filter-select" *ngIf="viewMode === 'class'">
          <mat-label>班级</mat-label>
          <mat-select [(value)]="selectedClassId" (selectionChange)="loadSchedules()">
            <mat-option *ngFor="let c of classes" [value]="c.id">
              {{ c.grade }}年级 {{ c.name }}
            </mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field class="filter-select" *ngIf="viewMode === 'teacher'">
          <mat-label>教师</mat-label>
          <mat-select [(value)]="selectedTeacherId" (selectionChange)="loadSchedules()">
            <mat-option *ngFor="let t of teachers" [value]="t.id">
              {{ t.name }}
            </mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field class="filter-select" *ngIf="viewMode === 'classroom'">
          <mat-label>教室</mat-label>
          <mat-select [(value)]="selectedClassroomId" (selectionChange)="loadSchedules()">
            <mat-option *ngFor="let c of classrooms" [value]="c.id">
              {{ c.name }}
            </mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      <div class="action-bar">
        <button mat-raised-button color="primary" (click)="runAutoSchedule(true)" [disabled]="!selectedSemesterId || scheduling">
          <mat-icon>auto_awesome</mat-icon>
          自动排课（保留锁定）
        </button>
        <button mat-raised-button (click)="runAutoSchedule(false)" [disabled]="!selectedSemesterId || scheduling">
          <mat-icon>refresh</mat-icon>
          重新排课（忽略锁定）
        </button>
        <button mat-button (click)="refreshAll()">
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

      <mat-progress-bar *ngIf="scheduling" mode="indeterminate"></mat-progress-bar>

      <div class="stats-bar" *ngIf="selectedSemesterId">
        <div class="stat-item">
          <div class="num">{{ semesterStats.scheduled }}</div>
          <div class="lbl">已排课次</div>
        </div>
        <div class="stat-item locked">
          <div class="num">{{ semesterStats.locked }}</div>
          <div class="lbl">其中锁定</div>
        </div>
        <div
          class="stat-item unscheduled clickable"
          [class.locate-flash]="flashPanel === 'unscheduled'"
          (click)="scrollToPanel('unscheduledPanel')"        >
          <div class="num">{{ semesterStats.unscheduledCourses }} 门 / {{ semesterStats.unscheduledHours }} 节</div>
          <div class="lbl">未排课程（点击查看）</div>
        </div>
        <div
          class="stat-item conflict clickable"
          [class.locate-flash]="flashPanel === 'conflict'"
          (click)="scrollToPanel('conflictPanel')"
        >
          <div class="num">{{ semesterConflicts.length }}</div>
          <div class="lbl">资源冲突（点击定位）</div>
        </div>
      </div>

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
                    *ngFor="let day of [1,2,3,4,5]; let di = index"
                    [id]="cellId(day, i + 1)"
                    [class.locate-cell]="isHighlightCell(day, i + 1)"
                    style="padding: 8px; border: 1px solid #ddd; vertical-align: top; min-height: 80px;"
                  >
                    <ng-container *ngFor="let entry of getEntryAt(day, i + 1)">
                      <mat-card
                        class="schedule-card"
                        [class.conflict-entry]="entry.is_conflict"
                        [class.locked-entry]="entry.is_locked"
                        [class.locate-flash]="isHighlightEntry(entry)"
                        [attr.data-entry-id]="entry.id"
                        style="margin-bottom: 4px;"
                      >
                        <div class="schedule-course">{{ entry.course_name }}</div>
                        <div class="schedule-detail">{{ entry.teacher_name }}</div>
                        <div class="schedule-detail">{{ entry.classroom_name }}</div>
                        <div class="schedule-detail">{{ entry.class_name }}</div>
                        <div style="margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap;">
                          <mat-chip *ngIf="entry.is_locked" color="accent" selected>锁定</mat-chip>
                          <button
                            mat-stroked-button
                            *ngIf="entry.is_conflict"
                            color="warn"
                            type="button"
                            (click)="locateEntryConflicts(entry)"
                          >
                            冲突
                          </button>
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
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div *ngIf="schedules.length === 0 && selectedSemesterId" style="padding: 40px; text-align: center;">
          <p>当前没有排课数据。点击"自动排课"按钮开始。</p>
        </div>

        <div *ngIf="!selectedSemesterId" style="padding: 40px; text-align: center;">
          <p>请先选择一个学期。</p>
        </div>
      </div>

      <div class="issue-panel">
        <mat-card #unscheduledPanel id="unscheduled-panel">
          <mat-card-header>
            <mat-icon mat-card-avatar style="color: #f44336;">error_outline</mat-icon>
            <mat-card-title>未排课程（{{ unscheduledCourses.length }}）</mat-card-title>
            <mat-card-subtitle>资源不足导致课时未排满，点击条目定位课程</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content style="margin-top: 10px;">
            <div
              class="issue-row"
              *ngFor="let item of unscheduledCourses"
              (click)="locateUnscheduled(item)"
            >
              <div class="issue-title">
                {{ item.class_name }} · {{ item.course_name }}
                <mat-chip color="warn" selected>{{ reasonLabel(item.reason) }}</mat-chip>
              </div>
              <div class="issue-sub">
                任课教师：{{ item.teacher_name }} ｜
                应排 {{ item.weekly_hours }} 节，已排 {{ item.scheduled_hours }} 节，
                缺 {{ item.unscheduled_hours }} 节
              </div>
              <div class="issue-sub">{{ item.detail }}</div>
            </div>
            <p *ngIf="unscheduledCourses.length === 0" style="color: green; margin-top: 10px;">
              所有课程均已排满。
            </p>
          </mat-card-content>
        </mat-card>

        <mat-card #conflictPanel id="conflict-panel">
          <mat-card-header>
            <mat-icon mat-card-avatar style="color: #ff9800;">warning_amber</mat-icon>
            <mat-card-title>资源冲突（{{ semesterConflicts.length }}）</mat-card-title>
            <mat-card-subtitle>教师 / 教室 / 班级同时段占用，点击条目定位课表</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content style="margin-top: 10px;">
            <div
              class="issue-row"
              *ngFor="let c of semesterConflicts"
              (click)="locateConflict(c)"
            >
              <div class="issue-title">
                <mat-chip
                  [color]="c.conflict_type === 'teacher' ? 'primary' : c.conflict_type === 'classroom' ? 'accent' : 'warn'"
                  selected
                >{{ conflictTypeLabel(c.conflict_type) }}</mat-chip>
                周{{ c.day_of_week }} 第{{ c.period }}节
                <span *ngIf="isLockedConflict(c)" style="color:#f9a825;">（含锁定课次）</span>
              </div>
              <div class="issue-sub">{{ c.message }}</div>
            </div>
            <p *ngIf="semesterConflicts.length === 0" style="color: green; margin-top: 10px;">
              未发现同时段资源冲突。
            </p>
          </mat-card-content>
        </mat-card>
      </div>

      <div *ngIf="schedulingMessage" style="margin-top: 16px;">
        <mat-card>
          <mat-card-content>
            <p>{{ schedulingMessage }}</p>
          </mat-card-content>
        </mat-card>
      </div>
    </div>
  `
})
export class TimetableComponent implements OnInit {
  @ViewChild('timetableContainer') timetableContainer!: ElementRef;
  @ViewChild('unscheduledPanel') unscheduledPanel!: ElementRef<HTMLElement>;
  @ViewChild('conflictPanel') conflictPanel!: ElementRef<HTMLElement>;

  semesters: Semester[] = [];
  classes: Class[] = [];
  teachers: Teacher[] = [];
  classrooms: Classroom[] = [];
  schedules: ScheduleEntry[] = [];
  semesterEntries: ScheduleEntry[] = [];
  semesterConflicts: Conflict[] = [];
  unscheduledCourses: UnscheduledCourse[] = [];
  selectedSemesterId: number | null = null;
  selectedClassId: number | null = null;
  selectedTeacherId: number | null = null;
  selectedClassroomId: number | null = null;
  viewMode: 'class' | 'teacher' | 'classroom' = 'class';
  schedulingMessage: string = '';
  scheduling = false;
  currentSemester: Semester | null = null;

  semesterStats = {
    scheduled: 0,
    locked: 0,
    unscheduledCourses: 0,
    unscheduledHours: 0,
  };

  // 定位状态：被点击课程对应的格子/卡片会高亮闪烁
  highlightCourseId: number | null = null;
  highlightClassId: number | null = null;
  highlightDay: number | null = null;
  highlightPeriod: number | null = null;
  highlightEntryIds = new Set<number>();
  flashPanel: '' | 'unscheduled' | 'conflict' = '';

  private pendingLocate: {
    kind: 'unscheduled' | 'conflict' | 'entry';
    classId?: number;
    courseId?: number;
    day?: number;
    period?: number;
    entryIds?: number[];
  } | null = null;
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;
  private panelTimer: ReturnType<typeof setTimeout> | null = null;

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

  constructor(
    private api: ApiService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.loadSemesters();
    this.loadClasses();
    this.loadTeachers();
    this.loadClassrooms();
    this.route.queryParamMap.subscribe(params => {
      const semesterId = params.get('semester_id');
      const kind = params.get('locate');
      if (!semesterId || !kind) return;
      this.selectedSemesterId = Number(semesterId);
      if (kind === 'unscheduled') {
        this.pendingLocate = {
          kind: 'unscheduled',
          classId: Number(params.get('class_id')) || undefined,
          courseId: Number(params.get('course_id')) || undefined,
        };
      } else if (kind === 'conflict') {
        this.pendingLocate = {
          kind: 'conflict',
          day: Number(params.get('day')) || undefined,
          period: Number(params.get('period')) || undefined,
          entryIds: (params.get('entries') || '')
            .split(',').filter(Boolean).map(Number),
        };
      }
    });
  }

  loadSemesters(): void {
    this.api.getSemesters().subscribe(data => {
      this.semesters = data;
      if (!this.selectedSemesterId) {
        const active = data.find(s => s.is_active);
        if (active) this.selectedSemesterId = active.id;
      }
      this.currentSemester =
        data.find(s => s.id === this.selectedSemesterId) || null;
      this.updatePeriodsFromSemester();
      this.loadSemesterOverview();
    });
  }

  loadClasses(): void {
    this.api.getClasses().subscribe(data => {
      this.classes = data;
      if (this.pendingLocate?.kind === 'unscheduled' && this.pendingLocate.classId) {
        // 跨页定位未排课程时强制切到目标班级，而不是默认第一个班
        this.selectedClassId = this.pendingLocate.classId;
      } else if (data.length > 0 && !this.selectedClassId) {
        this.selectedClassId = data[0].id;
      }
      if (this.selectedSemesterId) this.loadSchedules();
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
      this.currentSemester =
        this.semesters.find(s => s.id === this.selectedSemesterId) || null;
      this.updatePeriodsFromSemester();
      this.refreshAll();
    }
  }

  /** 同时刷新当前视角课表、整学期课次、冲突、未排清单 */
  refreshAll(): void {
    this.loadSchedules();
    this.loadSemesterOverview();
  }

  loadSemesterOverview(): void {
    if (!this.selectedSemesterId) return;
    const semesterId = this.selectedSemesterId;
    this.api.getSchedulesBySemester(semesterId).subscribe(data => {
      this.semesterEntries = data;
      this.semesterStats.scheduled = data.length;
      this.semesterStats.locked = data.filter(e => e.is_locked).length;
      this.tryConsumePendingLocate();
    });
    this.api.getConflicts(semesterId).subscribe(data => {
      this.semesterConflicts = data;
    });
    this.api.getUnscheduledCourses(semesterId).subscribe(data => {
      this.unscheduledCourses = data;
      this.semesterStats.unscheduledCourses = data.length;
      this.semesterStats.unscheduledHours = data.reduce(
        (sum, item) => sum + item.unscheduled_hours, 0
      );
      this.tryConsumePendingLocate();
    });
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
      this.tryConsumePendingLocate();
    });
  }

  getEntryAt(day: number, period: number): ScheduleEntry[] {
    return this.schedules.filter(e => e.day_of_week === day && e.period === period);
  }

  runAutoSchedule(respectLocked: boolean): void {
    if (!this.selectedSemesterId) return;
    this.scheduling = true;
    this.schedulingMessage = '正在自动排课，请稍候...';

    this.api.autoSchedule(this.selectedSemesterId, respectLocked).subscribe({
      next: result => this.handleScheduleResult(result),
      error: () => {
        this.scheduling = false;
        this.schedulingMessage = '自动排课失败，请检查基础数据后重试。';
      }
    });
  }

  private handleScheduleResult(result: AutoScheduleResult): void {
    this.scheduling = false;
    const stats = result.stats;
    const parts: string[] = [
      `排课完成：应排 ${stats.requested_hours} 节`,
      `已排 ${stats.scheduled_count} 节（含锁定 ${stats.locked_count} 节，新排 ${stats.newly_scheduled_count} 节）`,
    ];
    if (stats.unscheduled_course_count > 0) {
      parts.push(
        `⚠ ${stats.unscheduled_course_count} 门课程共 ${stats.unscheduled_hours} 节因资源不足未能安排`
      );
    }
    if (result.conflicts.length > 0) {
      parts.push(`发现 ${result.conflicts.length} 个资源冲突`);
    }
    this.schedulingMessage = parts.join('，');
    this.refreshAll();
  }

  toggleLock(entry: ScheduleEntry): void {
    this.api.updateScheduleEntry(entry.id, { is_locked: !entry.is_locked }).subscribe(() => {
      entry.is_locked = !entry.is_locked;
      this.loadSemesterOverview();
    });
  }

  // ===== 冲突 / 未排课程定位 =====

  reasonLabel(reason: UnscheduledReason): string {
    const map: Record<UnscheduledReason, string> = {
      teacher_unavailable: '教师可用时间不足',
      classroom_capacity: '教室容量不足',
      classroom_type: '无匹配教室类型',
      classroom_occupied: '教室全部占用',
      teacher_occupied: '教师时段占用',
      class_occupied: '班级时段占用',
      no_free_slot: '无可用时段',
      locked_conflict: '锁定课次冲突',
    };
    return map[reason] || reason;
  }

  conflictTypeLabel(type: string): string {
    const map: Record<string, string> = {
      teacher: '教师冲突',
      classroom: '教室冲突',
      class: '班级冲突',
      locked: '锁定冲突',
    };
    return map[type] || type;
  }

  isLockedConflict(c: Conflict): boolean {
    return c.involved_entries.some(id =>
      this.semesterEntries.some(e => e.id === id && e.is_locked)
    );
  }

  cellId(day: number, period: number): string {
    return `tt-cell-${day}-${period}`;
  }

  isHighlightCell(day: number, period: number): boolean {
    return this.highlightDay === day && this.highlightPeriod === period;
  }

  isHighlightEntry(entry: ScheduleEntry): boolean {
    if (this.highlightEntryIds.has(entry.id)) return true;
    return !!(
      this.highlightCourseId &&
      entry.course === this.highlightCourseId &&
      (!this.highlightClassId || entry.class_id === this.highlightClassId)
    );
  }

  /** 未排课程：切到对应班级课表，高亮该课程；若课程一节课都没排上则滚动未排面板 */
  locateUnscheduled(item: UnscheduledCourse): void {
    this.viewMode = 'class';
    this.selectedClassId = item.class_id;
    this.highlightCourseId = item.course;
    this.highlightClassId = item.class_id;
    this.highlightDay = null;
    this.highlightPeriod = null;
    this.highlightEntryIds.clear();
    this.loadSchedules();
    setTimeout(() => {
      const anyPlaced = this.schedules.some(e => e.course === item.course);
      if (anyPlaced) {
        this.scrollToFirstCourseEntry(item.course, item.class_id);
      } else {
        this.flashPanelCard('unscheduledPanel');
      }
    }, 400);
    this.scheduleHighlightClear();
  }

  /** 冲突：定位到周X第Y节，并高亮涉及的课次 */
  locateConflict(c: Conflict): void {
    const first = this.semesterEntries.find(e => c.involved_entries.includes(e.id));
    if (first) {
      this.viewMode = 'class';
      this.selectedClassId = first.class_id;
    }
    this.highlightDay = c.day_of_week;
    this.highlightPeriod = c.period;
    this.highlightCourseId = null;
    this.highlightClassId = null;
    this.highlightEntryIds = new Set(c.involved_entries);
    this.loadSchedules();
    setTimeout(() => this.scrollToCell(c.day_of_week, c.period), 400);
    this.scheduleHighlightClear();
  }

  /** 课表卡片上的“冲突”按钮：滚动到冲突面板中对应的条目 */
  locateEntryConflicts(entry: ScheduleEntry): void {
    const related = this.semesterConflicts.filter(c =>
      c.involved_entries.includes(entry.id)
    );
    this.flashPanelCard('conflictPanel');
    if (related.length > 0) {
      this.highlightDay = related[0].day_of_week;
      this.highlightPeriod = related[0].period;
      this.highlightEntryIds = new Set(related[0].involved_entries);
      this.scheduleHighlightClear();
    }
  }

  private scrollToCell(day: number, period: number): void {
    const el = document.getElementById(this.cellId(day, period));
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  private scrollToFirstCourseEntry(courseId: number, classId: number): void {
    const entry = this.schedules.find(
      e => e.course === courseId && e.class_id === classId
    );
    if (entry) this.scrollToCell(entry.day_of_week, entry.period);
  }

  scrollToPanel(which: 'unscheduledPanel' | 'conflictPanel'): void {
    const ref = which === 'unscheduledPanel' ? this.unscheduledPanel : this.conflictPanel;
    ref?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.flashPanel = which === 'unscheduledPanel' ? 'unscheduled' : 'conflict';
    if (this.panelTimer) clearTimeout(this.panelTimer);
    this.panelTimer = setTimeout(() => (this.flashPanel = ''), 1800);
  }

  private flashPanelCard(which: 'unscheduledPanel' | 'conflictPanel'): void {
    this.scrollToPanel(which);
  }

  private scheduleHighlightClear(): void {
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => {
      this.highlightCourseId = null;
      this.highlightClassId = null;
      this.highlightDay = null;
      this.highlightPeriod = null;
      this.highlightEntryIds.clear();
    }, 4000);
  }

  /** 跨页（冲突页）跳来后，等待学期总览与视角数据都加载完再执行定位 */
  private tryConsumePendingLocate(): void {
    const locate = this.pendingLocate;
    if (!locate) return;
    if (!this.semesterEntries.length) return;
    // 定位操作都会切换到班级视角，需要班级课表加载完成
    if (!this.selectedClassId || !this.schedules.length) return;

    if (locate.kind === 'unscheduled' && locate.classId && locate.courseId) {
      this.pendingLocate = null;
      this.locateUnscheduled({
        class_id: locate.classId,
        course: locate.courseId,
      } as UnscheduledCourse);
    } else if (locate.kind === 'conflict' && locate.day && locate.period) {
      this.pendingLocate = null;
      this.locateConflict({
        day_of_week: locate.day,
        period: locate.period,
        involved_entries: locate.entryIds || [],
      } as Conflict);
    }
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
