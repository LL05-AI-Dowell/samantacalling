import { Routes, Route } from 'react-router-dom';
import './App.css'
import Client from './Pages/Client/Client';
import Manager from './Pages/Manager/Manager';
import { AppProvider } from './context/ContextProvider';

function App() {

  return (
    <>
    <AppProvider>
      <Routes>
        <Route path='/' element={<Client/>} />
        <Route path='/admin' element={<Manager/>} />
      </Routes>
    </AppProvider>
    </>
  )
}

export default App
