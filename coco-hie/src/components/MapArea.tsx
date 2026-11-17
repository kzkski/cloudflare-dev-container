import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, AttributionControl } from 'react-leaflet'

// 地図エリアコンポーネント
function MapArea() {
  const [mapError, setMapError] = useState<string | null>(null)

  useEffect(() => {
    // Leaflet のタイル読み込みエラーを検知
    const handleTileError = () => {
      setMapError('地図を読み込めません。ネットワークを確認してください。')
    }

    // 簡易的に image の error を監視（Leaflet の内部イベント）
    const originalImage = window.Image
    const ImageProxy = new Proxy(originalImage, {
      construct(target, args) {
        const img = new target(...args)
        img.addEventListener('error', (e) => {
          const src = (e.target as HTMLImageElement)?.src || ''
          if (src.includes('cyberjapandata.gsi.go.jp')) {
            handleTileError()
          }
        })
        return img
      },
    })
    window.Image = ImageProxy as unknown as typeof window.Image

    return () => {
      window.Image = originalImage
    }
  }, [])

  if (mapError) {
    return <div className="map-error">{mapError}</div>
  }

  return (
    <MapContainer
      center={[34.7058, 137.7344]}
      zoom={14}
      scrollWheelZoom={false}
      style={{ width: '100%', height: '100%' }}
      attributionControl={false}
    >
      <TileLayer
        url="https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"
        attribution='出典：国土地理院'
      />
      <AttributionControl position="bottomright" prefix={false} />
    </MapContainer>
  )
}

export default MapArea
