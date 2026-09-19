import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../services/api.service';
import type { Semester } from '../../types';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatSelectModule],
  template: `
    <div class="page-container">
      <h1 class="page-title">Dashboard</h1>

      <div class="filter-bar">
        <mat-form-field class="filter-select">
          <mat-label>统计学期</mat-label>
          <mat-select [(value)]="selectedSemesterId" (selectionChange)="loadScheduleStats()">
            <mat-option *ngFor="let s of semesters" [value]="s.id">
              {{ s.name }}
              <span *ngIf="s.is_active" style="color: green;"> (当前)</span>
            </mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px;">
        <mat-card class="stat-card">
          <div class="stat-value">{{ stats.classrooms }}</div>
          <div class="stat-label">教室数量</div>
        </mat-card>

        <mat-card class="stat-card">
          <div class="stat-value">{{ stats.teachers }}</div>
          <div class="stat-label">教师数量</div>
        </mat-card>

        <mat-card class="stat-card">
          <div class="stat-value">{{ stats.classes }}</div>
          <div class="stat-label">班级数量</div>
        </mat-card>

        <mat-card class="stat-card">
          <div class="stat-value">{{ stats.courses }}</div>
          <div class="stat-label">课程数量</div>
        </mat-card>

        <mat-card class="stat-card">
          <div class="stat-value">{{ stats.semesters }}</div>
          <div class="stat-label">学期数量</div>
        </mat-card>

        <mat-card
          class="stat-card clickable-card"
          (click)="goToTimetable()"
          [style.cursor]="'pointer'"
        >
          <div class="stat-value" [style.color]="stats.scheduledEntries > 0 ? '#1976d2' : '#999'">
            {{ stats.scheduledEntries }}
          </div>
          <div class="stat-label">已排课次（锁定 {{ stats.lockedEntries }}）— 点击查看课表</div>
        </mat-card>

        <mat-card
          class="stat-card clickable-card"
          (click)="goToConflicts()"
          [style.cursor]="'pointer'"
        >
          <div class="stat-value" [style.color]="stats.conflicts > 0 ? '#f44336' : '#4caf50'">
            {{ stats.conflicts }}
          </div>
          <div class="stat-label">冲突数量 — 点击处理</div>
        </mat-card>

        <mat-card
          class="stat-card clickable-card"
          (click)="goToConflicts()"
          [style.cursor]="'pointer'"
        >
          <div class="stat-value" [style.color]="stats.unscheduledHours > 0 ? '#e65100' : '#4caf50'">
            {{ stats.unscheduledHours }}
          </div>
          <div class="stat-label">
            未排课时（{{ stats.unscheduledCourseCount }} 门课）— 点击查看原因
          </div>
        </mat-card>
      </div>
    </div>
  `
})
export class DashboardComponent implements OnInit {
  semesters: Semester[] = [];
  selectedSemesterId: number | null = null;
  stats = {
    classrooms: 0,
    teachers: 0,
    classes: 0,
    courses: 0,
    semesters: 0,
    conflicts: 0,
    scheduledEntries: 0,
    lockedEntries: 0,
    unscheduledHours: 0,
    unscheduledCourseCount: 0
  };

  constructor(private api: ApiService, private router: Router) {}

  ngOnInit(): void {
    this.api.getClassrooms().subscribe(data => this.stats.classrooms = data.length);
    this.api.getTeachers().subscribe(data => this.stats.teachers = data.length);
    this.api.getClasses().subscribe(data => this.stats.classes = data.length);
    this.api.getCourses().subscribe(data => this.stats.courses = data.length);
    this.api.getSemesters().subscribe(data => {
      this.stats.semesters = data.length;
      this.semesters = data;
      const active = data.find(s => s.is_active) || data[0];
      if (active) {
        this.selectedSemesterId = active.id;
        this.loadScheduleStats();
      }
    });
  }

  loadScheduleStats(): void {
    if (!this.selectedSemesterId) return;
    this.api.getSchedulingStatus(this.selectedSemesterId).subscribe(status => {
      this.stats.scheduledEntries = status.scheduled_entries;
      this.stats.lockedEntries = status.locked_entries;
      this.stats.unscheduledHours = status.unscheduled_hours;
      this.stats.unscheduledCourseCount = status.unscheduled_courses.length;
      this.stats.conflicts = status.conflict_count;
    });
  }

  goToConflicts(): void {
    if (!this.selectedSemesterId) return;
    this.router.navigate(['/conflicts'], {
      queryParams: { semester_id: this.selectedSemesterId }
    });
  }

  goToTimetable(): void {
    if (!this.selectedSemesterId) return;
    this.router.navigate(['/timetable'], {
      queryParams: { semester_id: this.selectedSemesterId }
    });
  }
}
