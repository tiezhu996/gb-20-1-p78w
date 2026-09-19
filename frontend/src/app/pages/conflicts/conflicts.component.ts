import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { ApiService } from '../../services/api.service';
import type { Conflict, UnscheduledCourse, UnscheduledReasonCode, Semester } from '../../types';

@Component({
  selector: 'app-conflicts',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatSelectModule,
    MatCardModule
  ],
  template: `
    <div class="page-container">
      <h1 class="page-title">冲突与未排课程管理</h1>

      <div class="filter-bar">
        <mat-form-field class="filter-select">
          <mat-label>学期</mat-label>
          <mat-select [(value)]="selectedSemesterId" (selectionChange)="loadData()">
            <mat-option *ngFor="let s of semesters" [value]="s.id">
              {{ s.name }}
              <span *ngIf="s.is_active" style="color: green;"> (当前)</span>
            </mat-option>
          </mat-select>
        </mat-form-field>

        <button mat-button (click)="loadData()">
          <mat-icon>refresh</mat-icon>
          刷新
        </button>
      </div>

      <div class="stats-bar">
        <mat-card class="stat-mini conflict" [class.has-warning]="conflicts.length > 0">
          <mat-icon>warning</mat-icon>
          <div>
            <div class="stat-mini-value">{{ conflicts.length }}</div>
            <div class="stat-mini-label">已排课冲突</div>
          </div>
        </mat-card>
        <mat-card class="stat-mini unscheduled" [class.has-warning]="unscheduledCourses.length > 0">
          <mat-icon>event_busy</mat-icon>
          <div>
            <div class="stat-mini-value">{{ totalUnscheduledHours }}</div>
            <div class="stat-mini-label">未排课时 · {{ unscheduledCourses.length }} 门课程</div>
          </div>
        </mat-card>
      </div>

      <h3>已排冲突（点击行定位课表）</h3>
      <div class="table-container">
        <table mat-table [dataSource]="conflicts" class="mat-elevation-z8">
          <ng-container matColumnDef="conflict_type">
            <th mat-header-cell *matHeaderCellDef>冲突类型</th>
            <td mat-cell *matCellDef="let item">
              <mat-chip
                [color]="item.conflict_type === 'teacher' ? 'primary' : item.conflict_type === 'classroom' ? 'accent' : 'warn'"
                selected
              >
                {{ getConflictTypeLabel(item.conflict_type) }}
              </mat-chip>
            </td>
          </ng-container>

          <ng-container matColumnDef="position">
            <th mat-header-cell *matHeaderCellDef>位置</th>
            <td mat-cell *matCellDef="let item">
              周{{ item.day_of_week }} 第{{ item.period }}节
            </td>
          </ng-container>

          <ng-container matColumnDef="resource">
            <th mat-header-cell *matHeaderCellDef>涉及资源</th>
            <td mat-cell *matCellDef="let item">{{ getResourceLabel(item) }}</td>
          </ng-container>

          <ng-container matColumnDef="message">
            <th mat-header-cell *matHeaderCellDef>详情</th>
            <td mat-cell *matCellDef="let item">{{ item.message }}</td>
          </ng-container>

          <ng-container matColumnDef="resolved">
            <th mat-header-cell *matHeaderCellDef>状态</th>
            <td mat-cell *matCellDef="let item">
              <span [style.color]="item.resolved ? 'green' : '#f44336'">
                {{ item.resolved ? '已解决' : '未解决' }}
              </span>
            </td>
          </ng-container>

          <ng-container matColumnDef="action">
            <th mat-header-cell *matHeaderCellDef>操作</th>
            <td mat-cell *matCellDef="let item">
              <button mat-stroked-button color="primary" (click)="locateConflict(item)">
                <mat-icon>my_location</mat-icon>
                定位课表
              </button>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row
              *matRowDef="let row; columns: displayedColumns;"
              class="clickable-row"
              (click)="locateConflict(row)"></tr>
        </table>

        <div *ngIf="conflicts.length === 0" style="padding: 30px; text-align: center;">
          <p>当前学期暂无已排冲突。</p>
        </div>
      </div>

      <h3 style="margin-top: 28px;">未能排满的课程（资源不足留痕）</h3>
      <div class="table-container">
        <table mat-table [dataSource]="unscheduledCourses" class="mat-elevation-z8">
          <ng-container matColumnDef="course">
            <th mat-header-cell *matHeaderCellDef>班级 / 课程 / 教师</th>
            <td mat-cell *matCellDef="let u">
              {{ u.class_name }} · {{ u.course_name }} · {{ u.teacher_name }}
            </td>
          </ng-container>

          <ng-container matColumnDef="hours">
            <th mat-header-cell *matHeaderCellDef>课时情况</th>
            <td mat-cell *matCellDef="let u">
              需求 {{ u.requested_hours }}（锁定 {{ u.locked_hours }}，新排 {{ u.scheduled_hours }}），
              <strong style="color: #e65100;">缺 {{ u.unscheduled_hours }}</strong>
            </td>
          </ng-container>

          <ng-container matColumnDef="reason">
            <th mat-header-cell *matHeaderCellDef>未排原因</th>
            <td mat-cell *matCellDef="let u">
              <mat-chip color="warn" selected>{{ getReasonLabel(u.reason_code) }}</mat-chip>
              <div style="font-size: 12px; color: #666; margin-top: 4px;">{{ u.reason_detail }}</div>
            </td>
          </ng-container>

          <ng-container matColumnDef="action">
            <th mat-header-cell *matHeaderCellDef>操作</th>
            <td mat-cell *matCellDef="let u">
              <button mat-stroked-button color="primary" (click)="locateUnscheduled(u); $event.stopPropagation()">
                <mat-icon>my_location</mat-icon>
                定位课程
              </button>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="unscheduledColumns"></tr>
          <tr mat-row
              *matRowDef="let row; columns: unscheduledColumns;"
              class="clickable-row"
              (click)="locateUnscheduled(row)"></tr>
        </table>

        <div *ngIf="unscheduledCourses.length === 0" style="padding: 30px; text-align: center;">
          <p>当前学期所有课程均已排满，没有未排课时。</p>
        </div>
      </div>

      <div style="margin-top: 20px;">
        <h3>说明</h3>
        <ul>
          <li><strong>教师冲突</strong>：同一教师在同一时间段被安排多门课程</li>
          <li><strong>教室冲突</strong>：同一教室在同一时间段被安排多门课程</li>
          <li><strong>班级冲突</strong>：同一班级在同一时间段被安排多门课程</li>
          <li><strong>未排课程</strong>：教师可用时间、教室容量或班级时段不足导致排不满，系统保留锁定课次并逐条记录原因，绝不静默丢课</li>
        </ul>
        <p>解决方式：点击“定位”跳转到对应课表视角，手动调整或增加资源后，锁定正确课次再重新执行自动排课。</p>
      </div>
    </div>
  `
})
export class ConflictsComponent implements OnInit {
  displayedColumns: string[] = ['conflict_type', 'position', 'resource', 'message', 'resolved', 'action'];
  unscheduledColumns: string[] = ['course', 'hours', 'reason', 'action'];
  dataSource: Conflict[] = [];
  conflicts: Conflict[] = [];
  unscheduledCourses: UnscheduledCourse[] = [];
  semesters: Semester[] = [];
  selectedSemesterId: number | null = null;

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
    private router: Router,
    private route: ActivatedRoute
  ) {}

  get totalUnscheduledHours(): number {
    return this.unscheduledCourses.reduce((sum, u) => sum + u.unscheduled_hours, 0);
  }

  ngOnInit(): void {
    const querySemester = this.route.snapshot.queryParamMap.get('semester_id');
    this.api.getSemesters().subscribe(data => {
      this.semesters = data;
      const preset = querySemester ? Number(querySemester) : null;
      const active = data.find(s => s.id === preset) || data.find(s => s.is_active) || data[0];
      if (active) {
        this.selectedSemesterId = active.id;
        this.loadData();
      }
    });
  }

  getConflictTypeLabel(type: string): string {
    const map: Record<string, string> = {
      'teacher': '教师冲突',
      'classroom': '教室冲突',
      'class': '班级冲突'
    };
    return map[type] || type;
  }

  getReasonLabel(code: UnscheduledReasonCode): string {
    return this.reasonLabels[code] || code;
  }

  getResourceLabel(item: Conflict): string {
    if (item.conflict_type === 'teacher') {
      return item.related_teacher_name || `教师ID:${item.related_teacher}`;
    }
    if (item.conflict_type === 'classroom') {
      return item.related_classroom_name || `教室ID:${item.related_classroom}`;
    }
    return item.related_class_name || `班级ID:${item.related_class}`;
  }

  loadData(): void {
    if (!this.selectedSemesterId) return;
    this.api.getConflicts(this.selectedSemesterId).subscribe(data => {
      this.conflicts = data;
      this.dataSource = this.conflicts;
    });
    this.api.getUnscheduledCourses(this.selectedSemesterId).subscribe(data => {
      this.unscheduledCourses = data;
    });
  }

  /** 跳转到课表页并直接高亮冲突所在时间格子 */
  locateConflict(item: Conflict): void {
    const queryParams: Record<string, number | string> = {
      semester_id: item.semester,
      day: item.day_of_week,
      period: item.period
    };
    if (item.conflict_type === 'teacher' && item.related_teacher) {
      queryParams['view'] = 'teacher';
      queryParams['teacher_id'] = item.related_teacher;
    } else if (item.conflict_type === 'classroom' && item.related_classroom) {
      queryParams['view'] = 'classroom';
      queryParams['classroom_id'] = item.related_classroom;
    } else if (item.conflict_type === 'class' && item.related_class) {
      queryParams['view'] = 'class';
      queryParams['class_id'] = item.related_class;
    }
    this.router.navigate(['/timetable'], { queryParams });
  }

  /** 跳转到课表页并切到该未排课程的班级视角 */
  locateUnscheduled(u: UnscheduledCourse): void {
    this.router.navigate(['/timetable'], {
      queryParams: {
        semester_id: u.semester,
        view: 'class',
        class_id: u.class_id
      }
    });
  }
}
