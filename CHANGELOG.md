# Changelog

All notable changes to the inspir project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- 62 additional study tools
- Flashcard generator
- Note-taking system
- Study planner
- Citation generator
- Concept mapper
- Mobile app versions
- Advanced analytics dashboard

---

## [1.0.0] - 2024-12-10

### Added - Initial Release

#### Core Features
- **Quiz Generator**: AI-powered quiz generation from uploaded documents (PDF, DOCX, TXT) or pasted text
- **Study Timer**: Pomodoro-style focus timer with customizable intervals
- **Grade Calculator**: Semester grade planning and prediction tool
- **Student Forum**: Community discussion board with topics and comments

#### Authentication & User Management
- User registration and login with Supabase Auth
- Password reset functionality
- Guest mode for unauthenticated users
- JWT-based session management
- User dashboard with statistics and history

#### Quiz System
- 10 AI-generated questions per quiz
- Mixed question types (multiple choice and short answer)
- Intelligent grading with Claude AI
- Quiz history tracking
- Score statistics and performance metrics
- Detailed answer explanations

#### Study Timer
- Customizable work intervals (1-60 minutes)
- Customizable break intervals (1-30 minutes)
- Audio notifications
- Session tracking
- Pause/resume functionality

#### Grade Calculator
- Multiple assignment types (homework, quiz, exam, project)
- Weight-based grade calculations
- Current grade display
- Final grade prediction
- What-if scenario planning

#### Student Forum
- Create discussion posts
- Comment on posts
- Topic categories
- Real-time updates
- User attribution

#### Technical Infrastructure
- React 18 frontend with Vite
- Node.js/Express backend
- Supabase for auth and database
- Anthropic Claude 4.5 API integration
- nginx reverse proxy setup
- PM2 process management
- SSL/TLS with Let's Encrypt
- Ubuntu server deployment

#### Documentation
- Comprehensive README
- Deployment guide
- API documentation
- Database schema documentation
- Environment configuration templates

#### SEO & Marketing Pages
- Homepage with feature highlights
- About page
- How It Works page
- Use Cases page
- FAQ page
- Privacy Policy
- Terms of Service
- Blog system foundation

#### Developer Experience
- Environment file templates
- Deployment scripts
- nginx configuration files
- systemd service files
- Git repository setup
- .gitignore for security

---

## Version History

### [1.0.0] - 2024-12-10
Initial public release of inspir - The Only Study Toolkit You Need

---

## Types of Changes

- **Added** for new features
- **Changed** for changes in existing functionality
- **Deprecated** for soon-to-be removed features
- **Removed** for now removed features
- **Fixed** for any bug fixes
- **Security** for vulnerability fixes

---

## Future Releases

### [1.1.0] - Planned
- Quiz difficulty selection
- Custom timer sound uploads
- Forum search and filtering
- Grade Calculator export to PDF

### [1.2.0] - Planned
- Flashcard generator from study materials
- Spaced repetition system
- Study group features
- Real-time collaboration

### [2.0.0] - Vision
- Complete 67-tool suite
- Mobile applications (iOS/Android)
- Advanced analytics and insights
- Personalized learning paths
- Integration with popular LMS platforms

---

**Note:** This changelog will be updated with each release to track all changes, improvements, and fixes to the inspir platform.
