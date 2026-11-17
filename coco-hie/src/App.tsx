import MapArea from './components/MapArea'
import SpotList from './components/SpotList'

function App() {
  return (
    <>
      <header className="app-header">ココヒエ</header>
      <div className="map-area">
        <MapArea />
      </div>
      <div className="list-area">
        <SpotList />
      </div>
    </>
  )
}

export default App
