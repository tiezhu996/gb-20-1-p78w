import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import type { Conflict, Semester, UnscheduledCourse } from '../../types';

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
  styles: [`
    .summary-bar {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .summary-card {
      min-width: 160px;
      padding: 14px 18px;
      border-left: 4px solid #ff9800;
      background: #fff8f0;
      border-radius: 6px;
    }
    .summary-card.unscheduled { border-left-color: #f44336; background: #fdecea; }
    .summary-card .num { font-size: 26px; font-weight: 700; }
    .summary-card .lbl { font-size: 12px; color: #666; }
    .row-btn { cursor: pointer; }
    .unscheduled-row {
      cursor: pointer;
      padding: 10px 12px;
      border-bottom: 1px solid #eee;
    }
    .unscheduled-row:hover { background: #e3f2fd; }
    .sub { font-size: 12px; color: #666; margin-top: 2px; }
  `],
  template: `
    <div class="page-container">
      <h1 class="page-title">冲突与未排课程</h1>

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

      <div class="summary-bar">
        <div class="summary-card">
          <div class="num">{{ dataSource.length }}</div>
          <div class="lbl">资源冲突（教师 / 教室 / 班级）</div>
        </div>
        <div class="summary-card unscheduled">
          <div class="num">{{ unscheduledCourses.length }} 门 / {{ unscheduledHours }} 节</div>
          <div class="lbl">未排满课程（资源不足，未静默丢弃）</div>
        </div>
      </div>

      <div class="table-container">
        <table mat-table [dataSource]="dataSource" class="mat-elevation-z8">
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

          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef>操作</th>
            <td mat-cell *matCellDef="let item">
              <button
                mat-stroked-button
                color="primary"
                class="row-btn"
                (click)="locateConflict(item)"
              >
                <mat-icon>place</mat-icon>
                定位课表
              </button>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
        </table>

        <div *ngIf="dataSource.length === 0" style="padding: 40px; text-align: center;">
          <p>该学期暂无冲突记录。请先进行自动排课或手动检查。</p>
        </div>
      </div>

      <mat-card style="margin-top: 24px;">
        <mat-card-header>
          <mat-icon mat-card-avatar style="color: #f44336;">error_outline</mat-icon>
          <mat-card-title>未排课程清单（{{ unscheduledCourses.length }}）</mat-card-title>
          <mat-card-subtitle>
            点击任意条目跳转课表并定位对应课程；具体阻塞时段可在课表页查看
          </mat-card-subtitle>
        </mat-card-header>
        <mat-card-content style="margin-top: 10px;">
          <div
            class="unscheduled-row"
            *ngFor="let item of unscheduledCourses"
            (click)="locateUnscheduled(item)"
          >
            <div>
              <strong>{{ item.class_name }} · {{ item.course_name }}</strong>
              （{{ item.teacher_name }}）
              <mat-chip color="warn" selected>{{ getReasonLabel(item.reason) }}</mat-chip>
            </div>
            <div class="sub">
              应排 {{ item.weekly_hours }} 节，已排 {{ item.scheduled_hours }} 节，
              缺 {{ item.unscheduled_hours }} 节 ｜ {{ item.detail }}
            </div>
          </div>
          <p *ngIf="unscheduledCourses.length === 0" style="color: green; margin-top: 10px;">
            所有课程均已排满，没有因资源不足而未排的课时。
          </p>
        </mat-card-content>
      </mat-card>

      <div style="margin-top: 20px;">
        <h3>冲突类型说明</h3>
        <ul>
          <li><strong>教师冲突</strong>：同一教师在同一时间段被安排多门课程</li>
          <li><strong>教室冲突</strong>：同一教室在同一时间段被安排多门课程</li>
          <li><strong>班级冲突</strong>：同一班级在同一时间段被安排多门课程</li>
        </ul>
        <p>解决方式：在课表页手动调整排课位置，锁定正确的课程后重新执行自动排课。</p>
      </div>
    </div>
  `
})
export class ConflictsComponent implements OnInit {
  displayedColumns: string[] = ['conflict_type', 'position', 'message', 'resolved', 'actions'];
  dataSource: Conflict[] = [];
  unscheduledCourses: UnscheduledCourse[] = [];
  semesters: Semester[] = [];
  selectedSemesterId: number | null = null;

  constructor(
    private api: ApiService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.api.getSemesters().subscribe(data => {
      this.semesters = data;
      const querySemester = Number(this.route.snapshot.queryParamMap.get('semester_id'));
      if (querySemester && data.some(s => s.id === querySemester)) {
        this.selectedSemesterId = querySemester;
      } else {
        const active = data.find(s => s.is_active);
        this.selectedSemesterId = active ? active.id : (data[0]?.id ?? null);
      }
      this.loadData();
    });
  }

  get unscheduledHours(): number {
    return this.unscheduledCourses.reduce((sum, item) => sum + item.unscheduled_hours, 0);
  }

  getConflictTypeLabel(type: string): string {
    const map: Record<string, string> = {
      'teacher': '教师冲突',
      'classroom': '教室冲突',
      'class': '班级冲突',
      'locked': '锁定冲突'
    };
    return map[type] || type;
  }

  getReasonLabel(reason: string): string {
    const map: Record<string, string> = {
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

  loadData(): void {
    if (!this.selectedSemesterId) {
      this.dataSource = [];
      this.unscheduledCourses = [];
      return;
    }
    this.api.getConflicts(this.selectedSemesterId).subscribe(data => {
      this.dataSource = data;
    });
    this.api.getUnscheduledCourses(this.selectedSemesterId).subscribe(data => {
      this.unscheduledCourses = data;
    });
  }

  locateConflict(item: Conflict): void {
    this.router.navigate(['/timetable'], {
      queryParams: {
        semester_id: this.selectedSemesterId,
        locate: 'conflict',
        day: item.day_of_week,
        period: item.period,
        entries: item.involved_entries.join(',')
      }
    });
  }

  locateUnscheduled(item: UnscheduledCourse): void {
    this.router.navigate(['/timetable'], {
      queryParams: {
        semester_id: this.selectedSemesterId,
        locate: 'unscheduled',
        class_id: item.class_id,
        course_id: item.course
      }
    });
  }
}
