'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { claimToken } from '@/app/actions' // Call the server action

export default function ClaimPage() {
  const params = useParams()
  const [status, setStatus] = useState('claiming')

  useEffect(() => {
    // 1. Get the ID from the URL
    const id = params.id as string
    if (!id) return

    // 2. Ask the Server to mark it as found
    async function performClaim() {
      try {
        await claimToken(id)
        setStatus('success')
      } catch (err) {
        console.error(err)
        setStatus('error')
      }
    }

    performClaim()
  }, [params.id])

  // 3. The UI
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black text-white">
      {status === 'claiming' && <h1 className="text-2xl animate-pulse">Verifying Asset...</h1>}
      
      {status === 'success' && (
        <div className="text-center">
          <h1 className="text-4xl font-bold text-green-500 mb-4">ACCESS GRANTED</h1>
          <p className="text-xl">Asset Secured: $25.00</p>
        </div>
      )}

      {status === 'error' && (
        <div className="text-center">
          <h1 className="text-red-500 text-3xl">System Error</h1>
          <p>Could not verify token.</p>
        </div>
      )}
    </div>
  )
}