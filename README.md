# Invoice Portal

A full-stack web application for managing invoices with user authentication, invoice creation, and tracking.

## Features

- User authentication (Register/Login)
- Create, read, update, and delete invoices
- Invoice status tracking (draft, sent, paid, overdue, cancelled)
- Dashboard with statistics
- Responsive design

## Tech Stack

### Backend
- Node.js
- Express.js
- MariaDB (via mysql2)
- JWT for authentication
- bcryptjs for password hashing

### Frontend
- React
- React Router for navigation
- Axios for API calls
- CSS3 for styling

## Installation

### Prerequisites
- Node.js (v14 or higher)
- MariaDB
- npm or yarn

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the backend directory:
```bash
cp ../.env.example .env
```

4. Update the `.env` file with your configuration
   - `DATABASE_URL` (required), e.g. `mysql://user:password@localhost:3306/invoiceportal`
   - `JWT_SECRET` (required)
   - `DEFAULT_TENANT_KEY` (optional; defaults to `default`)
   - For multi-tenant setups you can also send `X-Tenant-Key` on auth requests

5. Start the backend server:
```bash
npm run dev
```

The backend will run on http://localhost:5000

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

The frontend will run on http://localhost:3000

## Usage

1. Register a new account or login with existing credentials
2. Navigate to the dashboard to see invoice statistics
3. Create new invoices with client information and line items
4. View all invoices and filter by status
5. Update or delete invoices as needed

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user

### Invoices
- `GET /api/invoices` - Get all invoices for authenticated user
- `GET /api/invoices/:id` - Get single invoice
- `POST /api/invoices` - Create new invoice
- `PUT /api/invoices/:id` - Update invoice
- `DELETE /api/invoices/:id` - Delete invoice

### Users
- `GET /api/users` - Get all users (admin only)
- `PUT /api/users/profile` - Update user profile

## License

ISC
