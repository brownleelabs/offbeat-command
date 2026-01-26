'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function ClaimPage() {
  const params = useParams()
  const [status, setStatus] = useState('claiming')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const rawId = params.id as string
    if (!rawId) return

    // THE FIX: Nuclear Cleaning
    // 1. Replace literal "%20" text with nothing
    // 2. Trim actual whitespace
    const id = rawId.replace(/%20/g, '').trim()

    async function performClaim() {
      try {
        console.log("Client: Cleaning ID...", rawId, "->", id)
        const supabase = createClient()
        
        const { data, error } = await supabase
          .from('tokens')
          .update({ status: 'found' })
          .eq('id', id)
          .select()

        if (error) throw error
        
        if (!data || data.length === 0) {
           throw new Error("ID not found (Check your database for " + id + ")")
        }

        setStatus('success')
      } catch (err: any) {
        console.error("Claim failed:", err)
        setStatus('error')
        setErrorMsg(err.message || "Unknown Error")
      }
    }

    performClaim()
  }, [params.id])

  return (
    <div className="flex flex-col h-screen w-screen items-center justify-center bg-black text-white p-4">
      {status === 'claiming' && <h1 className="text-2xl animate-pulse">Verifying Asset...</h1>}
      
      {status === 'success' && (
        <div className="text-center">
          <h1 className="text-4xl font-bold text-green-500 mb-4">ACCESS GRANTED</h1>
          <p className="text-xl">Asset Secured: $25.00</p>
        </div>
      )}

      {status === 'error' && (
        <div className="text-center">
          <h1 className="text-red-500 text-3xl font-bold mb-4">System Error</h1>
          <div className="bg-red-900/30 p-4 rounded border border-red-500/50">
            <p className="font-mono text-sm break-all">{errorMsg}</p>
          </div>
        </div>
      )}
    </div>
  )
}