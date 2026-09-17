import axios from 'axios'

const api = axios.create({
  baseURL: '/api/servers'
})

export default api
