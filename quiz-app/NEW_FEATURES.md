# New Features Implementation Guide

This document describes three new features added to inspir:
1. **Citation Generator** - Generate formatted citations in multiple styles
2. **Cornell Notes Generator** - AI-powered Cornell note-taking system
3. **Study Streaks** - Track daily study habits and build streaks

---

## 📋 Table of Contents

- [Backend Implementation Status](#backend-implementation-status)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [Frontend Implementation Guide](#frontend-implementation-guide)
- [Deployment Steps](#deployment-steps)

---

## ✅ Backend Implementation Status

### Completed:
- [x] Database schema for all three features
- [x] Citation Generator controller & routes
- [x] Cornell Notes Generator controller & routes
- [x] Study Streaks controller & routes
- [x] Routes registered in server.js
- [x] AI integration for Cornell Notes
- [x] Citation formatting utilities (MLA, APA, Chicago, Harvard)

### Pending:
- [ ] Database migration (run SQL on Supabase)
- [ ] Frontend components
- [ ] Integration with existing Dashboard
- [ ] Testing & debugging

---

## 🗄️ Database Schema

### File Location
`/root/quiz-app/backend/database-new-features.sql`

### Tables Created:

**Citation Generator:**
- `citations` - Stores individual citations
- `citation_projects` - Groups citations into projects
- `project_citations` - Junction table for projects

**Cornell Notes:**
- `cornell_notes` - Stores generated Cornell notes

**Study Streaks:**
- `study_activity` - Daily activity log
- `user_streaks` - Streak statistics

All tables include:
- Row Level Security (RLS) policies
- Proper indexes for performance
- User ownership validation

---

## 🔌 API Endpoints

### Citation Generator

Base URL: `/api/citations`

#### `POST /api/citations/generate`
Generate a formatted citation (works for guests & authenticated users)

**Request Body:**
```json
{
  "citationType": "book",  // book, article, website, journal, newspaper, video, podcast
  "citationStyle": "MLA",  // MLA, APA, Chicago, Harvard
  "sourceData": {
    "authors": [
      { "firstName": "John", "lastName": "Doe" }
    ],
    "title": "Book Title",
    "publisher": "Publisher Name",
    "year": "2024",
    "city": "New York"
  }
}
```

**Response:**
```json
{
  "citation": "<em>Book Title</em>. Publisher Name, 2024.",
  "saved": true,
  "citationId": "uuid",
  "data": { ...full citation object... }
}
```

#### `GET /api/citations/history`
Get user's citation history (authenticated)

**Query Parameters:**
- `style` - Filter by citation style (MLA, APA, etc.)
- `type` - Filter by citation type (book, article, etc.)
- `limit` - Number of results (default: 50)
- `offset` - Pagination offset (default: 0)

#### `GET /api/citations/:id`
Get a specific citation (authenticated)

#### `PUT /api/citations/:id`
Update a citation (authenticated)

#### `DELETE /api/citations/:id`
Delete a citation (authenticated)

#### `POST /api/citations/projects`
Create a citation project/bibliography (authenticated)

**Request Body:**
```json
{
  "projectName": "Research Paper Citations",
  "description": "Citations for my history paper",
  "defaultStyle": "MLA"
}
```

#### `GET /api/citations/projects/list`
Get all user's citation projects (authenticated)

#### `GET /api/citations/projects/:projectId/export`
Export bibliography in various formats (authenticated)

**Query Parameters:**
- `format` - Export format: `text`, `json`, or `bibtex`

---

### Cornell Notes Generator

Base URL: `/api/cornell-notes`

#### `POST /api/cornell-notes/generate`
Generate Cornell notes from content (works for guests & authenticated users)

**Request Body:**
```json
{
  "title": "Photosynthesis Notes",
  "subject": "Biology",
  "content": "Long text content to convert into Cornell notes..."
}
```

**Response:**
```json
{
  "cues": [
    "What is photosynthesis?",
    "Key components",
    "Importance"
  ],
  "notes": [
    "Process by which plants convert light into energy",
    "Requires sunlight, water, and CO2",
    "Produces oxygen and glucose"
  ],
  "summary": "Photosynthesis is the fundamental process by which plants create energy from sunlight, essential for life on Earth.",
  "saved": true,
  "noteId": "uuid"
}
```

#### `GET /api/cornell-notes/history`
Get user's Cornell notes history (authenticated)

**Query Parameters:**
- `subject` - Filter by subject
- `limit` - Number of results (default: 50)
- `offset` - Pagination offset (default: 0)

#### `GET /api/cornell-notes/:id`
Get a specific Cornell note (authenticated)

#### `PUT /api/cornell-notes/:id`
Update a Cornell note (authenticated)

#### `DELETE /api/cornell-notes/:id`
Delete a Cornell note (authenticated)

---

### Study Streaks

Base URL: `/api/streaks`

#### `POST /api/streaks/activity`
Log a study activity (authenticated)

**Request Body:**
```json
{
  "activityType": "quiz",  // quiz, timer, notes, citation, doubt, etc.
  "timeMinutes": 25
}
```

**Response:**
```json
{
  "activity": {
    "id": "uuid",
    "user_id": "uuid",
    "activity_date": "2024-12-10",
    "activity_type": "quiz",
    "activity_count": 1,
    "total_time_minutes": 25
  },
  "streak": {
    "current_streak": 7,
    "longest_streak": 15,
    "total_study_days": 42,
    "last_activity_date": "2024-12-10"
  }
}
```

#### `GET /api/streaks/current`
Get current user's streak information (authenticated)

**Response:**
```json
{
  "current_streak": 7,
  "longest_streak": 15,
  "total_study_days": 42,
  "last_activity_date": "2024-12-10",
  "streak_freeze_count": 0
}
```

#### `GET /api/streaks/history`
Get study activity history (authenticated)

**Query Parameters:**
- `days` - Number of days to retrieve (default: 30)

**Response:**
```json
{
  "activities": [...array of activities...],
  "groupedByDate": {
    "2024-12-10": [...activities on this date...],
    "2024-12-09": [...activities on this date...]
  },
  "totalDays": 7
}
```

#### `GET /api/streaks/stats`
Get activity statistics by type (authenticated)

**Query Parameters:**
- `days` - Number of days to analyze (default: 30)

**Response:**
```json
{
  "quiz": {
    "count": 15,
    "totalTimeMinutes": 180
  },
  "timer": {
    "count": 20,
    "totalTimeMinutes": 500
  }
}
```

---

## 🎨 Frontend Implementation Guide

### 1. Citation Generator Component

**Location:** `/root/quiz-app/frontend/src/pages/CitationGenerator.jsx`

**Features to implement:**
- Form with dropdowns for citation type and style
- Dynamic form fields based on citation type selected
- Display formatted citation
- Save to library button (authenticated users)
- View citation history
- Create/manage citation projects
- Export bibliography

**UI Sections:**
1. **Generator Form**
   - Citation Type selector (Book, Article, Website, etc.)
   - Citation Style selector (MLA, APA, Chicago, Harvard)
   - Dynamic input fields for source data
   - Generate button

2. **Results Display**
   - Formatted citation with proper HTML rendering
   - Copy to clipboard button
   - Save button (if authenticated)

3. **Citation Library** (authenticated only)
   - List of saved citations
   - Filter by type/style
   - Edit/Delete buttons
   - Add to project

4. **Projects** (authenticated only)
   - Create project
   - View projects
   - Export bibliography

### 2. Cornell Notes Generator Component

**Location:** `/root/quiz-app/frontend/src/pages/CornellNotes.jsx`

**Features to implement:**
- Text input or file upload for content
- Generate button
- Display Cornell notes in proper format
- Save notes (authenticated users)
- View notes history

**UI Sections:**
1. **Input Section**
   - Title and subject input
   - Large text area or file upload
   - Generate button

2. **Cornell Notes Display**
   - Three-column layout:
     - Cues (left, ~25% width)
     - Notes (right, ~75% width)
     - Summary (bottom, full width)
   - Professional formatting

3. **Notes Library** (authenticated only)
   - List of saved notes
   - Filter by subject
   - Edit/Delete buttons

### 3. Study Streaks Component

**Location:** `/root/quiz-app/frontend/src/components/StudyStreaks.jsx`

**Features to implement:**
- Current streak display
- Calendar heatmap of activity
- Statistics by activity type
- Motivational messages

**UI Sections:**
1. **Streak Display**
   - Large number showing current streak
   - 🔥 Fire emoji
   - Longest streak badge
   - Total study days

2. **Calendar Heatmap**
   - 30-day or 90-day view
   - Color intensity based on activity
   - Hover tooltips showing details

3. **Activity Stats**
   - Pie chart or bar graph
   - Breakdown by activity type
   - Total time spent

4. **Integration Points**
   - Call `/api/streaks/activity` when user:
     - Completes a quiz
     - Uses the doubt solver
     - Completes a timer session
     - Generates Cornell notes
     - Creates citations

---

## 🚀 Deployment Steps

### Step 1: Run Database Migration

```bash
# Log into Supabase dashboard
# Go to SQL Editor
# Copy contents of backend/database-new-features.sql
# Execute the SQL to create tables

# Or use Supabase CLI:
supabase db push
```

### Step 2: Test Backend APIs

```bash
# Start the backend
cd /root/quiz-app/backend
npm run dev

# Test citation endpoint
curl -X POST http://localhost:3000/api/citations/generate \
  -H "Content-Type: application/json" \
  -d '{
    "citationType": "book",
    "citationStyle": "MLA",
    "sourceData": {
      "authors": [{"firstName": "John", "lastName": "Doe"}],
      "title": "Test Book",
      "publisher": "Test Publisher",
      "year": "2024"
    }
  }'

# Test Cornell notes endpoint
curl -X POST http://localhost:3000/api/cornell-notes/generate \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Notes",
    "content": "This is test content that should be converted into Cornell notes format with cues, notes, and a summary."
  }'

# Test streaks endpoint (requires auth token)
curl -X GET http://localhost:3000/api/streaks/current \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Step 3: Build Frontend Components

1. Create Citation Generator page
2. Create Cornell Notes page
3. Create Study Streaks component
4. Integrate streaks into Dashboard
5. Add navigation links

### Step 4: Integration Testing

1. Test guest access (Citation & Cornell Notes)
2. Test authenticated access (all features)
3. Test streak tracking across different activities
4. Test citation project management
5. Test data persistence

### Step 5: Deploy

```bash
# Pull latest code
cd /root/quiz-app
git pull origin main

# Run deployment script
./deploy.sh
```

---

## 📊 Activity Tracking Integration

To make Study Streaks work properly, integrate activity logging into existing features:

### Quiz Component
```javascript
// After quiz submission
await api.post('/api/streaks/activity', {
  activityType: 'quiz',
  timeMinutes: Math.round((endTime - startTime) / 60000)
});
```

### Chat Component
```javascript
// After sending a message
await api.post('/api/streaks/activity', {
  activityType: 'chat',
  timeMinutes: 1
});
```

### Timer Component
```javascript
// After timer completes
await api.post('/api/streaks/activity', {
  activityType: 'timer',
  timeMinutes: sessionLength
});
```

### Citation & Cornell Notes
```javascript
// After successful generation
await api.post('/api/streaks/activity', {
  activityType: 'citation', // or 'notes'
  timeMinutes: 1
});
```

---

## 🎯 Next Steps

1. **Immediate:** Run database migration on Supabase
2. **Short-term:** Build frontend components
3. **Medium-term:** Integrate activity tracking
4. **Long-term:** Add advanced features (streak freezes, achievements, etc.)

---

## 📝 Notes

- All endpoints support both guest (where applicable) and authenticated access
- RLS policies ensure users can only access their own data
- Study streaks automatically update via database triggers
- Citation formatter supports HTML formatting (use `dangerouslySetInnerHTML` in React)
- Cornell notes use Claude AI for intelligent note generation

---

**Status:** Backend Complete ✅ | Frontend Pending ⏳ | Database Migration Pending ⏳
