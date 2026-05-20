# 🎓 Exam Seating Plan Management Platform

A production-ready web application for managing exam seating plans, built with Node.js + Express + SQLite.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env and change JWT_SECRET to a secure random string
```

### 3. Start the Server
```bash
npm start
# Server starts at http://localhost:3000
```

### 4. Default Admin Credentials
- **Username:** `admin`
- **Password:** `admin123`
> ⚠️ Change the password immediately after first login!

---

## 🌐 URLs

| Page | URL |
|------|-----|
| Student Portal | `http://localhost:3000` |
| Admin Panel | `http://localhost:3000/admin` |

---

## 📊 Excel File Format

Your Excel file must follow this structure:

- **Sheet names = Room Numbers** (e.g., `B007`, `B013`, `C301`)
- **Summary sheets** are automatically skipped (any sheet with "summary", "capacity", etc. in the name)

**Inside each room sheet:**
```
Row 0: Title (END TERM EXAMINATIONS...)
Row 1: Date
Row 2: Room Number
Row 3: Course info
Row 4: Total students
Row 5: Column headers → ROW1, ROW3, ROW4, ROW6... (room row labels)
Row 6: Course names per column
Row 7+: Enrollment numbers (6 per column in standard layout)
Last 2: Count rows (automatically skipped)
```

---

## 🔧 Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js |
| Framework | Express.js |
| Database | SQLite (via sql.js — pure JS, no native build) |
| Excel Parser | SheetJS (xlsx) |
| Auth | JWT + bcryptjs |
| File Upload | Multer |
| Frontend | Vanilla HTML/CSS/JS |

---

## 📁 Project Structure

```
exam-seating/
├── server.js           # Main Express server + all API routes
├── parseExcel.js       # Excel parsing logic
├── database/
│   ├── db.js           # SQLite database module
│   └── seating.sqlite  # Database file (auto-created)
├── uploads/            # Uploaded Excel files
├── public/
│   ├── index.html      # Student Portal
│   └── admin/
│       └── index.html  # Admin Panel
├── .env                # Environment variables
├── .env.example        # Environment template
├── package.json
└── README.md
```

---

## 🔒 Security Notes

1. Change `JWT_SECRET` in `.env` to a long random string
2. Change default admin password immediately after first login
3. The `uploads/` folder stores Excel files — ensure proper permissions
4. All admin routes require JWT authentication

---

## 🚢 Deployment

### Using PM2 (Recommended)
```bash
npm install -g pm2
pm2 start server.js --name "exam-seating"
pm2 save
pm2 startup
```

### Using Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### Nginx Reverse Proxy
```nginx
server {
    listen 80;
    server_name your-domain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 📈 Scalability

- SQLite with indexed queries handles 50,000+ students efficiently
- For very large deployments (100k+), migrate to PostgreSQL (change `db.js`)
- Excel is parsed once on upload; searches use the database only
- JWT tokens expire in 8 hours

---

## 🆘 Troubleshooting

**Port in use?**
```bash
PORT=3001 npm start
```

**Database corrupted?**
```bash
rm database/seating.sqlite
npm start  # Re-creates with fresh schema
```

**Excel not parsing?**
- Ensure sheets are named as room numbers (e.g., B007, not "Room B007")
- Row 5 (0-indexed) must contain ROW1, ROW3, ROW4... style headers
