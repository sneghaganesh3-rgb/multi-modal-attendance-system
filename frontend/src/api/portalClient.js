import axios from 'axios';

// Student portal API client. Uses its own token so a student can never act as an admin.
const portalClient = axios.create({ baseURL: '/api/portal' });

portalClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('student_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

portalClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLogin = error.config?.url?.includes('/login');
    if (error.response?.status === 401 && !isLogin) {
      localStorage.removeItem('student_token');
      localStorage.removeItem('student');
      window.location.href = '/portal/login';
    }
    return Promise.reject(error);
  },
);

export default portalClient;
