import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import {
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  listPlannerEvents,
  createPlannerEvent,
  updatePlannerEvent,
  deletePlannerEvent,
  listCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  listGradeItems,
  createGradeItem,
  deleteGradeItem,
  getGpaSummary,
  listScheduleBlocks,
  createScheduleBlock,
  deleteScheduleBlock,
} from '../controllers/organizationController.js';

const router = express.Router();

// Note organizer
router.get('/notes', authenticateUser, listNotes);
router.post('/notes', authenticateUser, createNote);
router.patch('/notes/:id', authenticateUser, updateNote);
router.delete('/notes/:id', authenticateUser, deleteNote);

// Study planner events
router.get('/planner/events', authenticateUser, listPlannerEvents);
router.post('/planner/events', authenticateUser, createPlannerEvent);
router.patch('/planner/events/:id', authenticateUser, updatePlannerEvent);
router.delete('/planner/events/:id', authenticateUser, deletePlannerEvent);

// Courses
router.get('/courses', authenticateUser, listCourses);
router.post('/courses', authenticateUser, createCourse);
router.patch('/courses/:id', authenticateUser, updateCourse);
router.delete('/courses/:id', authenticateUser, deleteCourse);

// Assignments
router.get('/assignments', authenticateUser, listAssignments);
router.post('/assignments', authenticateUser, createAssignment);
router.patch('/assignments/:id', authenticateUser, updateAssignment);
router.delete('/assignments/:id', authenticateUser, deleteAssignment);

// GPA tracker
router.get('/gpa/items', authenticateUser, listGradeItems);
router.post('/gpa/items', authenticateUser, createGradeItem);
router.delete('/gpa/items/:id', authenticateUser, deleteGradeItem);
router.get('/gpa/summary', authenticateUser, getGpaSummary);

// Schedule builder
router.get('/schedule/blocks', authenticateUser, listScheduleBlocks);
router.post('/schedule/blocks', authenticateUser, createScheduleBlock);
router.delete('/schedule/blocks/:id', authenticateUser, deleteScheduleBlock);

export default router;

